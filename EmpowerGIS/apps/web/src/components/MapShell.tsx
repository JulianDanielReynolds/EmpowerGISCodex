import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { AnyLayer, Map as MapboxMap } from "mapbox-gl";
import {
  getLayerCatalog,
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
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
const PLACEHOLDER_MAPBOX_TOKEN = "replace-with-mapbox-public-token";

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
            "text-field": [
              "concat",
              ["to-string", ["round", ["coalesce", ["get", "elevation_ft"], 0]]],
              " ft"
            ],
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
            "fill-color": "#be185d",
            "fill-opacity": 0.24
          }
        } as AnyLayer,
        {
          id: "layer-zoning-outline",
          type: "line",
          source: sourceId,
          "source-layer": "zoning",
          paint: {
            "line-color": "#831843",
            "line-width": 1.1,
            "line-opacity": 0.95
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
            "circle-color": "#b45309",
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
              "#16a34a",
              "etj",
              "#f59e0b",
              "#6b7280"
            ],
            "fill-opacity": 0.2
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
              "#15803d",
              "etj",
              "#d97706",
              "#4b5563"
            ],
            "line-width": 1.4,
            "line-opacity": 0.95
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
            "fill-color": "#f59e0b",
            "fill-opacity": 0.22
          }
        } as AnyLayer
      ];
    case "parcels":
      return [
        {
          id: "layer-parcels",
          type: "line",
          source: sourceId,
          "source-layer": "parcels",
          minzoom: 13,
          paint: {
            "line-color": "#f3f4f6",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              0.4,
              16,
              1,
              19,
              1.8
            ],
            "line-opacity": 0.92
          }
        } as AnyLayer
      ];
    default:
      return [];
  }
}

function formatCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

export default function MapShell({
  user,
  accessToken,
  refreshToken,
  onSessionTokensUpdated,
  onLogout
}: MapShellProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [layers, setLayers] = useState<LayerCatalogItem[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [layersError, setLayersError] = useState<string | null>(null);

  const [selectedProperty, setSelectedProperty] = useState<PropertyLookupResult | null>(null);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [isLoadingProperty, setIsLoadingProperty] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PropertySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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
            acc[layer.key] = layer.key === "floodplain" || layer.key === "parcels";
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
      center: [-97.75, 30.27],
      zoom: 10.2
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.ScaleControl(), "bottom-right");
    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
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

  useEffect(() => {
    if (!accessToken || searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    const timeoutId = setTimeout(() => {
      void (async () => {
        setIsSearching(true);
        try {
          const results = await searchProperties(accessToken, searchQuery, 8, authRequestOptions);
          setSearchResults(results);
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      })();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [accessToken, searchQuery, authRequestOptions]);

  const activeLayerCount = useMemo(
    () => Object.values(layerVisibility).filter(Boolean).length,
    [layerVisibility]
  );

  const loadPropertyAt = useCallback(async (longitude: number, latitude: number) => {
    if (!accessToken) return;

    setIsLoadingProperty(true);
    setPropertyError(null);
    try {
      const property = await getPropertyByCoordinates(accessToken, longitude, latitude, authRequestOptions);
      setSelectedProperty(property);

      if (mapRef.current) {
        if (!markerRef.current) {
          markerRef.current = new mapboxgl.Marker({ color: "#cc3f2f" }).addTo(mapRef.current);
        }
        markerRef.current.setLngLat([longitude, latitude]);
      }
    } catch (error) {
      setSelectedProperty(null);
      setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
    } finally {
      setIsLoadingProperty(false);
    }
  }, [accessToken, authRequestOptions]);

  const handleMapClick = useCallback((event: mapboxgl.MapMouseEvent) => {
    const { lng, lat } = event.lngLat;
    void loadPropertyAt(lng, lat);
  }, [loadPropertyAt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !accessToken) return;

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [accessToken, handleMapClick]);

  const selectSearchResult = (result: PropertySearchResult) => {
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

  return (
    <main className="app-layout">
      <header className="top-bar">
        <div>
          <h1>EmpowerGIS</h1>
          <p>Austin Metro Land Intelligence</p>
        </div>
        <div className="top-bar-right">
          <span>{user?.username ?? "Unknown user"}</span>
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="content">
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
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by address, owner, or parcel key"
            />
            <button className="primary" type="button" onClick={() => setSearchQuery((value) => value.trim())}>
              {isSearching ? "..." : "Search"}
            </button>
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

        <aside className="panel">
          <h2>Parcel Data</h2>
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
              <tr>
                <th>Market Value</th>
                <td>{formatCurrency(selectedProperty?.marketValue)}</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </section>
    </main>
  );
}
