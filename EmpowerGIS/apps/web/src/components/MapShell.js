import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getLayerCatalog, getPropertyByParcelKey, getPropertyByCoordinates, searchProperties } from "../lib/api";
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const PLACEHOLDER_MAPBOX_TOKEN = "replace-with-mapbox-public-token";
const PARCEL_LAYER_IDS = ["layer-parcels-hit", "layer-parcels", "layer-parcels-outline"];
const MEASUREMENT_SOURCE_ID = "source-measurement";
const MEASUREMENT_AREA_LAYER_ID = "layer-measurement-area";
const MEASUREMENT_LINE_LAYER_ID = "layer-measurement-line";
const MEASUREMENT_POINT_LAYER_ID = "layer-measurement-points";
const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_TO_FEET = 3.280839895013123;
const SQUARE_METERS_PER_ACRE = 4_046.8564224;
const INITIAL_MAP_BOUNDS = [
    [-98.65, 29.35], // San Antonio area
    [-97.2, 31.2] // Temple area
];
function parseParcelKey(value) {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}
function toRadians(value) {
    return (value * Math.PI) / 180;
}
function calculateHaversineDistanceMeters(a, b) {
    const dLat = toRadians(b[1] - a[1]);
    const dLon = toRadians(b[0] - a[0]);
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return EARTH_RADIUS_METERS * c;
}
function calculateDistanceFeet(points) {
    if (points.length < 2)
        return 0;
    let distanceMeters = 0;
    for (let i = 1; i < points.length; i += 1) {
        const startPoint = points[i - 1];
        const endPoint = points[i];
        if (!startPoint || !endPoint)
            continue;
        distanceMeters += calculateHaversineDistanceMeters(startPoint, endPoint);
    }
    return distanceMeters * METERS_TO_FEET;
}
function calculateAreaAcres(points) {
    if (points.length < 3)
        return 0;
    let ringSum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        if (!current || !next)
            continue;
        const lon1 = toRadians(current[0]);
        const lon2 = toRadians(next[0]);
        const lat1 = toRadians(current[1]);
        const lat2 = toRadians(next[1]);
        ringSum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    const areaSquareMeters = Math.abs((ringSum * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
    return areaSquareMeters / SQUARE_METERS_PER_ACRE;
}
function formatFeet(value) {
    return `${value.toLocaleString("en-US", {
        minimumFractionDigits: value >= 10_000 ? 0 : 1,
        maximumFractionDigits: value >= 10_000 ? 0 : 1
    })} ft`;
}
function formatAcres(value) {
    return `${value.toLocaleString("en-US", {
        minimumFractionDigits: value >= 100 ? 1 : 2,
        maximumFractionDigits: value >= 100 ? 1 : 2
    })} acres`;
}
function buildMeasurementFeatureCollection(points, mode) {
    const features = points.map((point, index) => ({
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
        type: "FeatureCollection",
        features
    };
}
function ensureMeasurementLayers(map) {
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
        });
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
        });
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
        });
    }
}
function buildLayerDefinitions(layerKey, sourceId) {
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
                }
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
                },
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
                }
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
                },
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
                }
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
                },
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
                }
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
                },
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
                }
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
                },
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
                },
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
                }
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
                }
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
                },
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
                }
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
                },
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
                },
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
                }
            ];
        default:
            return [];
    }
}
export default function MapShell({ user, accessToken, refreshToken, onSessionTokensUpdated, onLogout, onOpenAdmin }) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const suppressNextAutocompleteRef = useRef(false);
    const [layers, setLayers] = useState([]);
    const [layerVisibility, setLayerVisibility] = useState({});
    const [layersError, setLayersError] = useState(null);
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [propertyError, setPropertyError] = useState(null);
    const [isLoadingProperty, setIsLoadingProperty] = useState(false);
    const [isPropertyPanelOpen, setIsPropertyPanelOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isMeasurementActive, setIsMeasurementActive] = useState(false);
    const [measurementMode, setMeasurementMode] = useState("distance");
    const [measurementPoints, setMeasurementPoints] = useState([]);
    const [measurementValue, setMeasurementValue] = useState("0 ft");
    const canRenderMap = Boolean(MAPBOX_TOKEN && !MAPBOX_TOKEN.includes(PLACEHOLDER_MAPBOX_TOKEN));
    const authRequestOptions = useMemo(() => ({
        refreshToken,
        onSessionTokensUpdated
    }), [refreshToken, onSessionTokensUpdated]);
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
                if (cancelled)
                    return;
                setLayers(catalog);
                setLayersError(null);
                setLayerVisibility(catalog.reduce((acc, layer) => {
                    acc[layer.key] = layer.key === "parcels";
                    return acc;
                }, {}));
            }
            catch (error) {
                if (cancelled)
                    return;
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
        mapboxgl.accessToken = token;
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
        if (!map)
            return;
        const syncLayers = () => {
            for (const layer of layers) {
                if (layer.status !== "ready")
                    continue;
                const sourceId = `source-${layer.key}`;
                const layerDefinitions = buildLayerDefinitions(layer.key, sourceId);
                if (layerDefinitions.length === 0)
                    continue;
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
                    map.setLayoutProperty(layerDefinition.id, "visibility", layerVisibility[layer.key] ? "visible" : "none");
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
    const runSearch = useCallback(async (query) => {
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
        }
        catch {
            setSearchResults([]);
        }
        finally {
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
        if (!accessToken)
            return;
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
        if (!isMeasurementActive)
            return;
        if (measurementMode === "distance") {
            setMeasurementValue(formatFeet(calculateDistanceFeet(measurementPoints)));
            return;
        }
        setMeasurementValue(formatAcres(calculateAreaAcres(measurementPoints)));
    }, [isMeasurementActive, measurementMode, measurementPoints]);
    useEffect(() => {
        const map = mapRef.current;
        if (!map)
            return;
        const syncMeasurementGraphics = () => {
            ensureMeasurementLayers(map);
            const source = map.getSource(MEASUREMENT_SOURCE_ID);
            if (!source)
                return;
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
        if (!map)
            return;
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
    const activeLayerCount = useMemo(() => Object.values(layerVisibility).filter(Boolean).length, [layerVisibility]);
    const shouldShowPropertyPanel = isPropertyPanelOpen && Boolean(selectedProperty || isLoadingProperty || propertyError);
    useEffect(() => {
        const map = mapRef.current;
        if (!map)
            return;
        const frameId = window.requestAnimationFrame(() => {
            map.resize();
        });
        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [shouldShowPropertyPanel]);
    const setMarkerAt = useCallback((longitude, latitude) => {
        if (!mapRef.current)
            return;
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude))
            return;
        if (!markerRef.current) {
            markerRef.current = new mapboxgl.Marker({ color: "#cc3f2f" })
                .setLngLat([longitude, latitude])
                .addTo(mapRef.current);
            return;
        }
        markerRef.current.setLngLat([longitude, latitude]);
    }, []);
    const loadPropertyAt = useCallback(async (longitude, latitude) => {
        if (!accessToken)
            return;
        setIsPropertyPanelOpen(true);
        setIsLoadingProperty(true);
        setPropertyError(null);
        try {
            const property = await getPropertyByCoordinates(accessToken, longitude, latitude, authRequestOptions);
            setSelectedProperty(property);
            setMarkerAt(longitude, latitude);
        }
        catch (error) {
            setSelectedProperty(null);
            setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
        }
        finally {
            setIsLoadingProperty(false);
        }
    }, [accessToken, authRequestOptions, setMarkerAt]);
    const loadPropertyByParcelKey = useCallback(async (parcelKey, fallbackCoordinates) => {
        if (!accessToken)
            return;
        setIsPropertyPanelOpen(true);
        setIsLoadingProperty(true);
        setPropertyError(null);
        try {
            const property = await getPropertyByParcelKey(accessToken, parcelKey, authRequestOptions);
            setSelectedProperty(property);
            setMarkerAt(property.coordinates.longitude, property.coordinates.latitude);
        }
        catch (error) {
            if (fallbackCoordinates) {
                try {
                    const property = await getPropertyByCoordinates(accessToken, fallbackCoordinates.longitude, fallbackCoordinates.latitude, authRequestOptions);
                    setSelectedProperty(property);
                    setMarkerAt(fallbackCoordinates.longitude, fallbackCoordinates.latitude);
                    return;
                }
                catch {
                    // fall through and show original parcel-key lookup error
                }
            }
            setSelectedProperty(null);
            setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
        }
        finally {
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
    const handleMapClick = useCallback((event) => {
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
                    const parcelKey = parseParcelKey(feature.properties?.parcel_key) ?? parseParcelKey(feature.properties?.parcelKey);
                    return parcelKey !== null;
                });
                const clickedParcelKey = parseParcelKey(parcelFeature?.properties?.parcel_key) ??
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
        if (!map || !accessToken)
            return;
        map.on("click", handleMapClick);
        return () => {
            map.off("click", handleMapClick);
        };
    }, [accessToken, handleMapClick]);
    const selectSearchResult = (result) => {
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
    return (_jsxs("main", { className: "app-layout", children: [_jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("h1", { children: "EmpowerGIS" }), _jsx("p", { children: "Austin Metro Land Intelligence" })] }), _jsxs("div", { className: "top-bar-right", children: [_jsx("span", { children: user?.username ?? "Unknown user" }), onOpenAdmin ? (_jsx("button", { className: "ghost", onClick: onOpenAdmin, children: "Admin" })) : null, _jsx("button", { className: "ghost", onClick: onLogout, children: "Logout" }), _jsx("a", { className: "partner-logo-link", href: "https://empower-communities.com/", target: "_blank", rel: "noreferrer noopener", "aria-label": "Visit Empower Communities", children: _jsx("img", { className: "partner-logo", src: "/ec-logo.svg", alt: "Empower Communities" }) })] })] }), _jsxs("section", { className: `content${shouldShowPropertyPanel ? " has-property-panel" : ""}`, children: [_jsxs("aside", { className: "panel", children: [_jsxs("h2", { children: ["Layers (", activeLayerCount, ")"] }), layersError ? _jsx("p", { className: "error", children: layersError }) : null, _jsx("ul", { children: layers.map((layer) => (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: Boolean(layerVisibility[layer.key]), disabled: layer.status !== "ready", onChange: (event) => setLayerVisibility((current) => ({
                                                    ...current,
                                                    [layer.key]: event.target.checked
                                                })) }), _jsx("span", { children: layer.name })] }) }, layer.key))) })] }), _jsxs("section", { className: "map-stage", children: [_jsxs("div", { className: "map-toolbar", children: [_jsx("input", { value: searchQuery, onChange: (event) => {
                                            const nextQuery = event.target.value;
                                            setSearchQuery(nextQuery);
                                            if (nextQuery.trim().length < 2) {
                                                setSearchResults([]);
                                            }
                                        }, onKeyDown: (event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                triggerSearch();
                                            }
                                        }, placeholder: "Search by address, owner, or parcel key" }), _jsx("button", { className: "primary", type: "button", onClick: triggerSearch, children: isSearching ? "..." : "Search" }), _jsx("button", { className: isMeasurementActive ? "primary measure-button" : "ghost measure-button", type: "button", onClick: () => {
                                            if (isMeasurementActive) {
                                                closeMeasurement();
                                                return;
                                            }
                                            setIsMeasurementActive(true);
                                            setMeasurementPoints([]);
                                            setMeasurementValue(measurementMode === "distance" ? "0 ft" : "0 acres");
                                        }, children: isMeasurementActive ? "Measuring" : "Measure" }), isMeasurementActive ? (_jsxs(_Fragment, { children: [_jsxs("select", { className: "measure-mode", value: measurementMode, onChange: (event) => {
                                                    const nextMode = event.target.value === "area" ? "area" : "distance";
                                                    setMeasurementMode(nextMode);
                                                    setMeasurementPoints([]);
                                                    setMeasurementValue(nextMode === "distance" ? "0 ft" : "0 acres");
                                                }, children: [_jsx("option", { value: "distance", children: "Linear Feet" }), _jsx("option", { value: "area", children: "Acres" })] }), _jsx("span", { className: "measure-value", children: measurementValue }), _jsx("button", { className: "ghost measure-clear", type: "button", onClick: clearMeasurement, children: "Clear" }), _jsx("button", { className: "ghost measure-close", type: "button", onClick: closeMeasurement, children: "Done" })] })) : null] }), searchResults.length > 0 ? (_jsx("div", { className: "search-dropdown", children: searchResults.map((result) => (_jsxs("button", { type: "button", className: "search-result", onClick: () => selectSearchResult(result), children: [_jsx("strong", { children: result.address }), _jsx("span", { children: result.parcelKey })] }, `${result.parcelKey}-${result.longitude}-${result.latitude}`))) })) : null, _jsx("div", { className: "map-canvas", children: canRenderMap ? (_jsx("div", { ref: mapContainerRef, className: "mapbox-host" })) : (_jsx("p", { children: "Set a valid `VITE_MAPBOX_ACCESS_TOKEN` in the web env file to enable the interactive map." })) })] }), shouldShowPropertyPanel ? (_jsxs("aside", { className: "panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("h2", { children: "Property Data" }), _jsx("button", { type: "button", className: "ghost panel-close", onClick: () => setIsPropertyPanelOpen(false), children: "Close" })] }), isLoadingProperty ? _jsx("p", { children: "Loading parcel data..." }) : null, propertyError ? _jsx("p", { className: "error", children: propertyError }) : null, _jsx("table", { children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("th", { children: "Address" }), _jsx("td", { children: selectedProperty?.address ?? "Click a parcel on the map" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Parcel Key" }), _jsx("td", { children: selectedProperty?.parcelKey ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Owner" }), _jsxs("td", { children: [_jsx("div", { children: selectedProperty?.ownerName ?? "N/A" }), _jsx("div", { className: "owner-address", children: selectedProperty?.ownerAddress?.trim() || "Owner mailing address unavailable" })] })] }), _jsxs("tr", { children: [_jsx("th", { children: "Acreage" }), _jsx("td", { children: selectedProperty?.acreage ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Zoning" }), _jsx("td", { children: selectedProperty?.zoning ?? "N/A" })] })] }) })] })) : null] })] }));
}
