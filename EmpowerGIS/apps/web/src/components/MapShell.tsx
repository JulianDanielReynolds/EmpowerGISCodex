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

const LAYER_STYLE: Record<string, { type: "fill" | "line"; paint: Record<string, unknown> }> = {
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
            acc[layer.key] = layer.key === "floodplain";
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
          if (!styleConfig) continue;
          const mapLayer: AnyLayer = {
            id: layerId,
            type: styleConfig.type,
            source: sourceId,
            "source-layer": layer.key,
            paint: styleConfig.paint
          } as AnyLayer;
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
