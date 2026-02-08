import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getLayerCatalog, getPropertyByCoordinates, searchProperties } from "../lib/api";
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const PLACEHOLDER_MAPBOX_TOKEN = "replace-with-mapbox-public-token";
const LAYER_STYLE = {
    floodplain: {
        type: "fill",
        paint: {
            "fill-color": "#3b82f6",
            "fill-opacity": 0.35
        }
    },
    contours: {
        type: "line",
        paint: {
            "line-color": "#8a5a2b",
            "line-width": 1.25,
            "line-opacity": 0.9
        }
    },
    zoning: {
        type: "fill",
        paint: {
            "fill-color": "#7c3aed",
            "fill-opacity": 0.24
        }
    },
    "water-infrastructure": {
        type: "line",
        paint: {
            "line-color": "#0d78c8",
            "line-width": 2
        }
    },
    "sewer-infrastructure": {
        type: "line",
        paint: {
            "line-color": "#8b5e34",
            "line-width": 2
        }
    },
    "cities-etj": {
        type: "fill",
        paint: {
            "fill-color": "#0e9f6e",
            "fill-opacity": 0.16
        }
    },
    "opportunity-zones": {
        type: "fill",
        paint: {
            "fill-color": "#f59e0b",
            "fill-opacity": 0.2
        }
    }
};
function formatCurrency(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "N/A";
    }
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
    });
}
export default function MapShell({ user, accessToken, refreshToken, onSessionTokensUpdated, onLogout }) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markerRef = useRef(null);
    const [layers, setLayers] = useState([]);
    const [layerVisibility, setLayerVisibility] = useState({});
    const [layersError, setLayersError] = useState(null);
    const [selectedProperty, setSelectedProperty] = useState(null);
    const [propertyError, setPropertyError] = useState(null);
    const [isLoadingProperty, setIsLoadingProperty] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
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
                    acc[layer.key] = layer.key === "floodplain";
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
        if (!map)
            return;
        const syncLayers = () => {
            for (const layer of layers) {
                if (layer.status !== "ready")
                    continue;
                const sourceId = `source-${layer.key}`;
                const layerId = `layer-${layer.key}`;
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "vector",
                        tiles: [layer.tileTemplate],
                        minzoom: 0,
                        maxzoom: 22
                    });
                }
                if (!map.getLayer(layerId)) {
                    const styleConfig = LAYER_STYLE[layer.key];
                    if (!styleConfig)
                        continue;
                    const mapLayer = {
                        id: layerId,
                        type: styleConfig.type,
                        source: sourceId,
                        "source-layer": layer.key,
                        paint: styleConfig.paint
                    };
                    map.addLayer(mapLayer);
                }
                map.setLayoutProperty(layerId, "visibility", layerVisibility[layer.key] ? "visible" : "none");
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
                }
                catch {
                    setSearchResults([]);
                }
                finally {
                    setIsSearching(false);
                }
            })();
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [accessToken, searchQuery, authRequestOptions]);
    const activeLayerCount = useMemo(() => Object.values(layerVisibility).filter(Boolean).length, [layerVisibility]);
    const loadPropertyAt = useCallback(async (longitude, latitude) => {
        if (!accessToken)
            return;
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
        }
        catch (error) {
            setSelectedProperty(null);
            setPropertyError(error instanceof Error ? error.message : "Unable to load parcel data");
        }
        finally {
            setIsLoadingProperty(false);
        }
    }, [accessToken, authRequestOptions]);
    const handleMapClick = useCallback((event) => {
        const { lng, lat } = event.lngLat;
        void loadPropertyAt(lng, lat);
    }, [loadPropertyAt]);
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
    return (_jsxs("main", { className: "app-layout", children: [_jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("h1", { children: "EmpowerGIS" }), _jsx("p", { children: "Austin Metro Land Intelligence" })] }), _jsxs("div", { className: "top-bar-right", children: [_jsx("span", { children: user?.username ?? "Unknown user" }), _jsx("button", { className: "ghost", onClick: onLogout, children: "Logout" })] })] }), _jsxs("section", { className: "content", children: [_jsxs("aside", { className: "panel", children: [_jsxs("h2", { children: ["Layers (", activeLayerCount, ")"] }), layersError ? _jsx("p", { className: "error", children: layersError }) : null, _jsx("ul", { children: layers.map((layer) => (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: Boolean(layerVisibility[layer.key]), disabled: layer.status !== "ready", onChange: (event) => setLayerVisibility((current) => ({
                                                    ...current,
                                                    [layer.key]: event.target.checked
                                                })) }), _jsx("span", { children: layer.name })] }) }, layer.key))) })] }), _jsxs("section", { className: "map-stage", children: [_jsxs("div", { className: "map-toolbar", children: [_jsx("input", { value: searchQuery, onChange: (event) => setSearchQuery(event.target.value), placeholder: "Search by address, owner, or parcel key" }), _jsx("button", { className: "primary", type: "button", onClick: () => setSearchQuery((value) => value.trim()), children: isSearching ? "..." : "Search" })] }), searchResults.length > 0 ? (_jsx("div", { className: "search-dropdown", children: searchResults.map((result) => (_jsxs("button", { type: "button", className: "search-result", onClick: () => selectSearchResult(result), children: [_jsx("strong", { children: result.address }), _jsx("span", { children: result.parcelKey })] }, `${result.parcelKey}-${result.longitude}-${result.latitude}`))) })) : null, _jsx("div", { className: "map-canvas", children: canRenderMap ? (_jsx("div", { ref: mapContainerRef, className: "mapbox-host" })) : (_jsx("p", { children: "Set a valid `VITE_MAPBOX_ACCESS_TOKEN` in the web env file to enable the interactive map." })) })] }), _jsxs("aside", { className: "panel", children: [_jsx("h2", { children: "Parcel Data" }), isLoadingProperty ? _jsx("p", { children: "Loading parcel data..." }) : null, propertyError ? _jsx("p", { className: "error", children: propertyError }) : null, _jsx("table", { children: _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("th", { children: "Address" }), _jsx("td", { children: selectedProperty?.address ?? "Click a parcel on the map" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Parcel Key" }), _jsx("td", { children: selectedProperty?.parcelKey ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Owner" }), _jsx("td", { children: selectedProperty?.ownerName ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Acreage" }), _jsx("td", { children: selectedProperty?.acreage ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Zoning" }), _jsx("td", { children: selectedProperty?.zoning ?? "N/A" })] }), _jsxs("tr", { children: [_jsx("th", { children: "Market Value" }), _jsx("td", { children: formatCurrency(selectedProperty?.marketValue) })] })] }) })] })] })] }));
}
