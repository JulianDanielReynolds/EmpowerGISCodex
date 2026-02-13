import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { AnyLayer, LngLatBoundsLike, Map as MapboxMap } from "mapbox-gl";
import {
  getLayerCatalog,
  getPropertyByParcelKey,
  getPropertyByCoordinates,
  searchProperties,
  type AuthUser,
  type LayerCatalogItem,
  type PropertyLookupResult,
  type PropertySearchResult,
  type SessionTokens
} from "../lib/api";

interface MapShellProps {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  onSessionTokensUpdated: (tokens: SessionTokens) => void;
  onLogout: () => void;
  onOpenAdmin?: () => void;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
const PLACEHOLDER_MAPBOX_TOKEN = "replace-with-mapbox-public-token";
const PARCEL_LAYER_IDS = ["layer-parcels-hit", "layer-parcels", "layer-parcels-outline"] as const;
const MEASUREMENT_SOURCE_ID = "source-measurement";
const MEASUREMENT_AREA_LAYER_ID = "layer-measurement-area";
const MEASUREMENT_LINE_LAYER_ID = "layer-measurement-line";
const MEASUREMENT_POINT_LAYER_ID = "layer-measurement-points";
const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_TO_FEET = 3.280839895013123;
const SQUARE_METERS_PER_ACRE = 4_046.8564224;
const INITIAL_MAP_BOUNDS: LngLatBoundsLike = [
  [-98.65, 29.35], // San Antonio area
  [-97.2, 31.2] // Temple area
];

type MeasurementMode = "distance" | "area";
type MeasurementPoint = [number, number];

function parseParcelKey(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function calculateHaversineDistanceMeters(a: MeasurementPoint, b: MeasurementPoint): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

function calculateDistanceFeet(points: MeasurementPoint[]): number {
  if (points.length < 2) return 0;
  let distanceMeters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const startPoint = points[i - 1];
    const endPoint = points[i];
    if (!startPoint || !endPoint) continue;
    distanceMeters += calculateHaversineDistanceMeters(startPoint, endPoint);
  }
  return distanceMeters * METERS_TO_FEET;
}

function calculateAreaAcres(points: MeasurementPoint[]): number {
  if (points.length < 3) return 0;
  let ringSum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    const lon1 = toRadians(current[0]);
    const lon2 = toRadians(next[0]);
    const lat1 = toRadians(current[1]);
    const lat2 = toRadians(next[1]);
    ringSum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  const areaSquareMeters = Math.abs((ringSum * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
  return areaSquareMeters / SQUARE_METERS_PER_ACRE;
}

function formatFeet(value: number): string {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 10_000 ? 0 : 1,
    maximumFractionDigits: value >= 10_000 ? 0 : 1
  })} ft`;
}

function formatAcres(value: number): string {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 100 ? 1 : 2,
    maximumFractionDigits: value >= 100 ? 1 : 2
  })} acres`;
}

function buildMeasurementFeatureCollection(
  points: MeasurementPoint[],
  mode: MeasurementMode
): any {
  const features: any[] = points.map((point, index) => ({
    type: "Feature",
    properties: { kind: "vertex", index },
    geometry: {
      type: "Point",
      coordinates: point
    }
  }));

  if (points.length >= 2) {
    features.push({
      type: "Feature",
      properties: { kind: "line" },
      geometry: {
        type: "LineString",
        coordinates: points
      }
    });
  }

  if (mode === "area" && points.length >= 3) {
    features.push({
      type: "Feature",
      properties: { kind: "area" },
      geometry: {
        type: "Polygon",
        coordinates: [[...points, points[0]]]
      }
    });
  }

  return {
    type: "FeatureCollection" as const,
    features
  };
}

function ensureMeasurementLayers(map: MapboxMap): void {
  if (!map.getSource(MEASUREMENT_SOURCE_ID)) {
    map.addSource(MEASUREMENT_SOURCE_ID, {
      type: "geojson",
      data: buildMeasurementFeatureCollection([], "distance")
    });
  }

  if (!map.getLayer(MEASUREMENT_AREA_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_AREA_LAYER_ID,
      type: "fill",
      source: MEASUREMENT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: {
        visibility: "none"
      },
      paint: {
        "fill-color": "#22c55e",
        "fill-opacity": 0.24
      }
    } as AnyLayer);
  }

  if (!map.getLayer(MEASUREMENT_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_LINE_LAYER_ID,
      type: "line",
      source: MEASUREMENT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        visibility: "none",
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-color": "#10b981",
        "line-width": 3,
        "line-opacity": 0.95
      }
    } as AnyLayer);
  }

  if (!map.getLayer(MEASUREMENT_POINT_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_POINT_LAYER_ID,
      type: "circle",
      source: MEASUREMENT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        visibility: "none"
      },
      paint: {
        "circle-color": "#34d399",
        "circle-radius": 5,
        "circle-opacity": 0.95,
        "circle-stroke-color": "#064e3b",
        "circle-stroke-width": 1.1
      }
    } as AnyLayer);
  }
}

function buildLayerDefinitions(layerKey: string, sourceId: string): AnyLayer[] {
  switch (layerKey) {
    case "floodplain":
      return [
        {
          id: "layer-floodplain",
          type: "fill",
          source: sourceId,
          "source-layer": "floodplain",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": 0.34
          }
        } as AnyLayer
      ];
    case "contours":
      return [
        {
          id: "layer-contours",
          type: "line",
          source: sourceId,
          "source-layer": "contours",
          paint: {
            "line-color": "#8a5a2b",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              0.9,
              14,
              1.3,
              17,
              2
            ],
            "line-opacity": 0.92
          }
        } as AnyLayer,
        {
          id: "layer-contours-label",
          type: "symbol",
          source: sourceId,
          "source-layer": "contours",
          minzoom: 13,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 260,
            "text-field": ["to-string", ["round", ["coalesce", ["get", "elevation_ft"], 0]]],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              9,
              16,
              12
            ]
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "#111827",
            "text-halo-width": 1.2,
            "text-opacity": 0.95
          }
        } as AnyLayer
      ];
    case "zoning":
      return [
        {
          id: "layer-zoning",
          type: "fill",
          source: sourceId,
          "source-layer": "zoning",
          paint: {
            "fill-color": [
              "coalesce",
              ["to-color", ["get", "zoning_color"]],
              "#7c3aed"
            ],
            "fill-opacity": 0.32
          }
        } as AnyLayer,
        {
          id: "layer-zoning-outline",
          type: "line",
          source: sourceId,
          "source-layer": "zoning",
          paint: {
            "line-color": [
              "coalesce",
              ["to-color", ["get", "zoning_color"]],
              "#5b21b6"
            ],
            "line-width": 1.4,
            "line-opacity": 0.98
          }
        } as AnyLayer
      ];
    case "water-infrastructure":
      return [
        {
          id: "layer-water-infrastructure",
          type: "line",
          source: sourceId,
          "source-layer": "water-infrastructure",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": "#0b84d8",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              1.2,
              15,
              2.5,
              18,
              4
            ],
            "line-opacity": 0.96
          }
        } as AnyLayer,
        {
          id: "layer-water-infrastructure-points",
          type: "circle",
          source: sourceId,
          "source-layer": "water-infrastructure",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#0b84d8",
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              1.5,
              16,
              4
            ],
            "circle-opacity": 0.9
          }
        } as AnyLayer
      ];
    case "sewer-infrastructure":
      return [
        {
          id: "layer-sewer-infrastructure",
          type: "line",
          source: sourceId,
          "source-layer": "sewer-infrastructure",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": "#a16207",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              1.2,
              15,
              2.5,
              18,
              4
            ],
            "line-opacity": 0.96
          }
        } as AnyLayer,
        {
          id: "layer-sewer-infrastructure-points",
          type: "circle",
          source: sourceId,
          "source-layer": "sewer-infrastructure",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#f97316",
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              2.2,
              14,
              4.8,
              16,
              6.2,
              18,
              7.2
            ],
            "circle-opacity": 0.95,
            "circle-stroke-color": "#111827",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              0.55,
              16,
              1.15
            ]
          }
        } as AnyLayer
      ];
    case "cities-etj":
      return [
        {
          id: "layer-cities-etj",
          type: "fill",
          source: sourceId,
          "source-layer": "cities-etj",
          paint: {
            "fill-color": [
              "match",
              ["downcase", ["coalesce", ["get", "boundary_type"], ""]],
              "city",
              "#00b157",
              "etj",
              "#f59e0b",
              "#0ea5e9"
            ],
            "fill-opacity": [
              "match",
              ["downcase", ["coalesce", ["get", "boundary_type"], ""]],
              "city",
              0.15,
              "etj",
              0.08,
              0.1
            ]
          }
        } as AnyLayer,
        {
          id: "layer-cities-etj-outline",
          type: "line",
          source: sourceId,
          "source-layer": "cities-etj",
          paint: {
            "line-color": [
              "match",
              ["downcase", ["coalesce", ["get", "boundary_type"], ""]],
              "city",
              "#00e66d",
              "etj",
              "#fbbf24",
              "#38bdf8"
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              1.2,
              10,
              2.1,
              13,
              3.3,
              16,
              4.2
            ],
            "line-opacity": 0.98
          },
          layout: {
            "line-cap": "round",
            "line-join": "round"
          }
        } as AnyLayer,
        {
          id: "layer-cities-etj-label",
          type: "symbol",
          source: sourceId,
          "source-layer": "cities-etj",
          minzoom: 8.8,
          layout: {
            "text-field": ["coalesce", ["get", "jurisdiction_name"], ""],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              10,
              12,
              12.5,
              15,
              15
            ],
            "text-letter-spacing": 0.03
          },
          paint: {
            "text-color": [
              "match",
              ["downcase", ["coalesce", ["get", "boundary_type"], ""]],
              "city",
              "#064e3b",
              "etj",
              "#78350f",
              "#0f172a"
            ],
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.25,
            "text-opacity": 0.95
          }
        } as AnyLayer
      ];
    case "opportunity-zones":
      return [
        {
          id: "layer-opportunity-zones",
          type: "fill",
          source: sourceId,
          "source-layer": "opportunity-zones",
          paint: {
            "fill-color": "#d97706",
            "fill-opacity": 0.3
          }
        } as AnyLayer
      ];
    case "oil-gas-leases":
      return [
        {
          id: "layer-oil-gas-leases-fill",
          type: "fill",
          source: sourceId,
          "source-layer": "oil-gas-leases",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": [
              "coalesce",
              ["to-color", ["get", "source_color"]],
              "#be123c"
            ],
            "fill-opacity": 0.27
          }
        } as AnyLayer,
        {
          id: "layer-oil-gas-leases-line",
          type: "line",
          source: sourceId,
          "source-layer": "oil-gas-leases",
          paint: {
            "line-color": [
              "coalesce",
              ["to-color", ["get", "source_color"]],
              "#9f1239"
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              0.9,
              12,
              1.4,
              15,
              2.1
            ],
            "line-opacity": 0.95
          }
        } as AnyLayer
      ];
    case "parcels":
      return [
        {
          id: "layer-parcels-hit",
          type: "fill",
          source: sourceId,
          "source-layer": "parcels",
          minzoom: 13,
          paint: {
            "fill-color": "#ffffff",
            "fill-opacity": 0
          }
        } as AnyLayer,
        {
          id: "layer-parcels-outline",
          type: "line",
          source: sourceId,
          "source-layer": "parcels",
          minzoom: 13,
          paint: {
            "line-color": "#0f172a",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              1.1,
              16,
              1.9,
              19,
              3.2
            ],
            "line-opacity": 0.8
          }
        } as AnyLayer,
        {
          id: "layer-parcels",
          type: "line",
          source: sourceId,
          "source-layer": "parcels",
          minzoom: 13,
          paint: {
            "line-color": "#ffffff",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              0.6,
              16,
              1.2,
              19,
              2.3
            ],
            "line-opacity": 0.96
          }
        } as AnyLayer
      ];
    default:
      return [];
  }
}

export default function MapShell({
  user,
  accessToken,
  refreshToken,
  onSessionTokensUpdated,
  onLogout,
  onOpenAdmin
}: MapShellProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const suppressNextAutocompleteRef = useRef(false);

  const [layers, setLayers] = useState<LayerCatalogItem[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [layersError, setLayersError] = useState<string | null>(null);

  const [selectedProperty, setSelectedProperty] = useState<PropertyLookupResult | null>(null);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [isLoadingProperty, setIsLoadingProperty] = useState(false);
  const [isPropertyPanelOpen, setIsPropertyPanelOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PropertySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMeasurementActive, setIsMeasurementActive] = useState(false);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("distance");
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [measurementValue, setMeasurementValue] = useState("0 ft");

  const canRenderMap = Boolean(MAPBOX_TOKEN && !MAPBOX_TOKEN.includes(PLACEHOLDER_MAPBOX_TOKEN));
  const authRequestOptions = useMemo(
    () => ({
      refreshToken,
      onSessionTokensUpdated
    }),
    [refreshToken, onSessionTokensUpdated]
  );

  useEffect(() => {
    if (!accessToken) {
      setLayers([]);
      setLayerVisibility({});
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const catalog = await getLayerCatalog(accessToken, authRequestOptions);
        if (cancelled) return;
        setLayers(catalog);
        setLayersError(null);
        setLayerVisibility(
          catalog.reduce<Record<string, boolean>>((acc: Record<string, boolean>, layer: LayerCatalogItem) => {
            acc[layer.key] = layer.key === "parcels";
            return acc;
          }, {})
        );
      } catch (error) {
        if (cancelled) return;
        setLayersError(error instanceof Error ? error.message : "Unable to load layer catalog");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, authRequestOptions]);

  useEffect(() => {
    if (!canRenderMap || !mapContainerRef.current || mapRef.current) {
      return;
    }

    const token = MAPBOX_TOKEN ?? "";
    (mapboxgl as unknown as { accessToken: string }).accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      bounds: INITIAL_MAP_BOUNDS,
      fitBoundsOptions: {
        padding: {
          top: 24,
          bottom: 24,
          left: 24,
          right: 24
        },
        maxZoom: 8.4
      }
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-right");
    map.scrollZoom.setWheelZoomRate(1 / 1800);
    map.scrollZoom.setZoomRate(1 / 180);
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [canRenderMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncLayers = () => {
      for (const layer of layers) {
        if (layer.status !== "ready") continue;
        const sourceId = `source-${layer.key}`;
        const layerDefinitions = buildLayerDefinitions(layer.key, sourceId);
        if (layerDefinitions.length === 0) continue;

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: "vector",
            tiles: [layer.tileTemplate],
            minzoom: 0,
            maxzoom: 22
          });
        }

        for (const layerDefinition of layerDefinitions) {
          if (!map.getLayer(layerDefinition.id)) {
            map.addLayer(layerDefinition);
          }
          map.setLayoutProperty(
            layerDefinition.id,
            "visibility",
            layerVisibility[layer.key] ? "visible" : "none"
          );
        }
      }
    };

    if (map.isStyleLoaded()) {
      syncLayers();
      return;
    }

    map.once("load", syncLayers);
    return () => {
      map.off("load", syncLayers);
    };
  }, [layers, layerVisibility]);

  const runSearch = useCallback(async (query: string) => {
    const normalizedQuery = query.trim();
    if (!accessToken || normalizedQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchProperties(accessToken, normalizedQuery, 8, authRequestOptions);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [accessToken, authRequestOptions]);

  useEffect(() => {
    if (!accessToken) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchQuery("");
      setIsPropertyPanelOpen(false);
      setIsMeasurementActive(false);
      setMeasurementMode("distance");
      setMeasurementPoints([]);
      setMeasurementValue("0 ft");
      suppressNextAutocompleteRef.current = false;
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (suppressNextAutocompleteRef.current) {
      suppressNextAutocompleteRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void runSearch(normalizedQuery);
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, searchQuery, runSearch]);

  useEffect(() => {
    if (!isMeasurementActive) return;
    if (measurementMode === "distance") {
      setMeasurementValue(formatFeet(calculateDistanceFeet(measurementPoints)));
      return;
    }
    setMeasurementValue(formatAcres(calculateAreaAcres(measurementPoints)));
  }, [isMeasurementActive, measurementMode, measurementPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncMeasurementGraphics = () => {
      ensureMeasurementLayers(map);
      const source = map.getSource(MEASUREMENT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;

      const featureCollection = isMeasurementActive
        ? buildMeasurementFeatureCollection(measurementPoints, measurementMode)
        : buildMeasurementFeatureCollection([], measurementMode);
      source.setData(featureCollection);

      const visibility = isMeasurementActive ? "visible" : "none";
      for (const layerId of [MEASUREMENT_AREA_LAYER_ID, MEASUREMENT_LINE_LAYER_ID, MEASUREMENT_POINT_LAYER_ID]) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visibility);
        }
      }
    };

    if (map.isStyleLoaded()) {
      syncMeasurementGraphics();
      return;
    }

    map.once("load", syncMeasurementGraphics);
    return () => {
      map.off("load", syncMeasurementGraphics);
    };
  }, [isMeasurementActive, measurementMode, measurementPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvas();
    if (canvas) {
      canvas.style.cursor = isMeasurementActive ? "crosshair" : "";
    }

    return () => {
      const cleanupCanvas = map.getCanvas();
      if (cleanupCanvas) {
        cleanupCanvas.style.cursor = "";
      }
    };
  }, [isMeasurementActive]);

  const activeLayerCount = useMemo(
    () => Object.values(layerVisibility).filter(Boolean).length,
    [layerVisibility]
  );
  const shouldShowPropertyPanel =
    isPropertyPanelOpen && Boolean(selectedProperty || isLoadingProperty || propertyError);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const frameId = window.requestAnimationFrame(() => {
      map.resize();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [shouldShowPropertyPanel]);

  const setMarkerAt = useCallback((longitude: number, latitude: number) => {
    if (!mapRef.current) return;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({ color: "#cc3f2f" })
        .setLngLat([longitude, latitude])
        .addTo(mapRef.current);
      return;
    }

    markerRef.current.setLngLat([longitude, latitude]);
  }, []);

  const loadPropertyAt = useCallback(async (longitude: number, latitude: number) => {
    if (!accessToken) return;

    setIsPropertyPanelOpen(true);
    setIsLoadingProperty(true);
    setPropertyError(null);
    try {
      const property = await getPropertyByCoordinates(accessToken, longitude, latitude, authRequestOptions);
      setSelectedProperty(property);
      setMarkerAt(longitude, latitude);
    } catch (error) {
      setSelectedProperty(null);
      setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
    } finally {
      setIsLoadingProperty(false);
    }
  }, [accessToken, authRequestOptions, setMarkerAt]);

  const loadPropertyByParcelKey = useCallback(async (
    parcelKey: string,
    fallbackCoordinates?: { longitude: number; latitude: number }
  ) => {
    if (!accessToken) return;

    setIsPropertyPanelOpen(true);
    setIsLoadingProperty(true);
    setPropertyError(null);
    try {
      const property = await getPropertyByParcelKey(accessToken, parcelKey, authRequestOptions);
      setSelectedProperty(property);
      setMarkerAt(property.coordinates.longitude, property.coordinates.latitude);
    } catch (error) {
      if (fallbackCoordinates) {
        try {
          const property = await getPropertyByCoordinates(
            accessToken,
            fallbackCoordinates.longitude,
            fallbackCoordinates.latitude,
            authRequestOptions
          );
          setSelectedProperty(property);
          setMarkerAt(fallbackCoordinates.longitude, fallbackCoordinates.latitude);
          return;
        } catch {
          // fall through and show original parcel-key lookup error
        }
      }

      setSelectedProperty(null);
      setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
    } finally {
      setIsLoadingProperty(false);
    }
  }, [accessToken, authRequestOptions, setMarkerAt]);

  const clearMeasurement = useCallback(() => {
    setMeasurementPoints([]);
    setMeasurementValue(measurementMode === "distance" ? "0 ft" : "0 acres");
  }, [measurementMode]);

  const closeMeasurement = useCallback(() => {
    setIsMeasurementActive(false);
    setMeasurementMode("distance");
    setMeasurementPoints([]);
    setMeasurementValue("0 ft");
  }, []);

  const handleMapClick = useCallback((event: mapboxgl.MapMouseEvent) => {
    if (isMeasurementActive) {
      setMeasurementPoints((current) => [
        ...current,
        [event.lngLat.lng, event.lngLat.lat]
      ]);
      return;
    }

    const map = mapRef.current;
    if (map) {
      const queryableLayerIds = PARCEL_LAYER_IDS.filter((layerId) => Boolean(map.getLayer(layerId)));
      if (queryableLayerIds.length > 0) {
        const parcelFeature = map.queryRenderedFeatures(event.point, { layers: queryableLayerIds }).find((feature) => {
          const parcelKey =
            parseParcelKey(feature.properties?.parcel_key) ?? parseParcelKey(feature.properties?.parcelKey);
          return parcelKey !== null;
        });
        const clickedParcelKey =
          parseParcelKey(parcelFeature?.properties?.parcel_key) ??
          parseParcelKey(parcelFeature?.properties?.parcelKey);
        if (clickedParcelKey) {
          void loadPropertyByParcelKey(clickedParcelKey, {
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat
          });
          return;
        }
      }
    }

    const { lng, lat } = event.lngLat;
    void loadPropertyAt(lng, lat);
  }, [isMeasurementActive, loadPropertyAt, loadPropertyByParcelKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !accessToken) return;

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [accessToken, handleMapClick]);

  const selectSearchResult = (result: PropertySearchResult) => {
    suppressNextAutocompleteRef.current = true;
    setSearchQuery(result.address);
    setSearchResults([]);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [result.longitude, result.latitude],
        zoom: 16.2,
        duration: 1100
      });
    }
    void loadPropertyAt(result.longitude, result.latitude);
  };

  const triggerSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (trimmed !== searchQuery) {
      setSearchQuery(trimmed);
    }
    void runSearch(trimmed);
  }, [searchQuery, runSearch]);

  return (
    <main className="app-layout">
      <header className="top-bar">
        <div>
          <h1>EmpowerGIS</h1>
          <p>Austin Metro Land Intelligence</p>
        </div>
        <div className="top-bar-right">
          <span>{user?.username ?? "Unknown user"}</span>
          {onOpenAdmin ? (
            <button className="ghost" onClick={onOpenAdmin}>
              Admin
            </button>
          ) : null}
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className={`content${shouldShowPropertyPanel ? " has-property-panel" : ""}`}>
        <aside className="panel">
          <h2>Layers ({activeLayerCount})</h2>
          {layersError ? <p className="error">{layersError}</p> : null}
          <ul>
            {layers.map((layer) => (
              <li key={layer.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(layerVisibility[layer.key])}
                    disabled={layer.status !== "ready"}
                    onChange={(event) =>
                      setLayerVisibility((current) => ({
                        ...current,
                        [layer.key]: event.target.checked
                      }))
                    }
                  />
                  <span>{layer.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </aside>

        <section className="map-stage">
          <div className="map-toolbar">
            <input
              value={searchQuery}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setSearchQuery(nextQuery);
                if (nextQuery.trim().length < 2) {
                  setSearchResults([]);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  triggerSearch();
                }
              }}
              placeholder="Search by address, owner, or parcel key"
            />
            <button className="primary" type="button" onClick={triggerSearch}>
              {isSearching ? "..." : "Search"}
            </button>
            <button
              className={isMeasurementActive ? "primary measure-button" : "ghost measure-button"}
              type="button"
              onClick={() => {
                if (isMeasurementActive) {
                  closeMeasurement();
                  return;
                }
                setIsMeasurementActive(true);
                setMeasurementPoints([]);
                setMeasurementValue(measurementMode === "distance" ? "0 ft" : "0 acres");
              }}
            >
              {isMeasurementActive ? "Measuring" : "Measure"}
            </button>
            {isMeasurementActive ? (
              <>
                <select
                  className="measure-mode"
                  value={measurementMode}
                  onChange={(event) => {
                    const nextMode = event.target.value === "area" ? "area" : "distance";
                    setMeasurementMode(nextMode);
                    setMeasurementPoints([]);
                    setMeasurementValue(nextMode === "distance" ? "0 ft" : "0 acres");
                  }}
                >
                  <option value="distance">Linear Feet</option>
                  <option value="area">Acres</option>
                </select>
                <span className="measure-value">{measurementValue}</span>
                <button className="ghost measure-clear" type="button" onClick={clearMeasurement}>
                  Clear
                </button>
                <button className="ghost measure-close" type="button" onClick={closeMeasurement}>
                  Done
                </button>
              </>
            ) : null}
          </div>

          {searchResults.length > 0 ? (
            <div className="search-dropdown">
              {searchResults.map((result) => (
                <button
                  key={`${result.parcelKey}-${result.longitude}-${result.latitude}`}
                  type="button"
                  className="search-result"
                  onClick={() => selectSearchResult(result)}
                >
                  <strong>{result.address}</strong>
                  <span>{result.parcelKey}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="map-canvas">
            {canRenderMap ? (
              <div ref={mapContainerRef} className="mapbox-host" />
            ) : (
              <p>
                Set a valid `VITE_MAPBOX_ACCESS_TOKEN` in the web env file to enable the interactive map.
              </p>
            )}
          </div>
        </section>

        {shouldShowPropertyPanel ? (
          <aside className="panel">
            <div className="panel-header">
              <h2>Parcel Data</h2>
              <button
                type="button"
                className="ghost panel-close"
                onClick={() => setIsPropertyPanelOpen(false)}
              >
                Close
              </button>
            </div>
            {isLoadingProperty ? <p>Loading parcel data...</p> : null}
            {propertyError ? <p className="error">{propertyError}</p> : null}
            <table>
              <tbody>
                <tr>
                  <th>Address</th>
                  <td>{selectedProperty?.address ?? "Click a parcel on the map"}</td>
                </tr>
                <tr>
                  <th>Parcel Key</th>
                  <td>{selectedProperty?.parcelKey ?? "N/A"}</td>
                </tr>
                <tr>
                  <th>Owner</th>
                  <td>{selectedProperty?.ownerName ?? "N/A"}</td>
                </tr>
                <tr>
                  <th>Acreage</th>
                  <td>{selectedProperty?.acreage ?? "N/A"}</td>
                </tr>
                <tr>
                  <th>Zoning</th>
                  <td>{selectedProperty?.zoning ?? "N/A"}</td>
                </tr>
              </tbody>
            </table>
          </aside>
        ) : null}
      </section>
    </main>
  );
}
