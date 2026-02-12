import { Router, type Request } from "express";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/http.js";

const tilesRouter = Router();

type LiveLayerConfig = {
  name: string;
  tableName: string;
  geometryColumn: string;
  whereSql?: string;
  propertySql: string[];
  vectorFields: Record<string, string>;
};

const LIVE_LAYERS: Record<string, LiveLayerConfig> = {
  floodplain: {
    name: "FEMA Floodplain",
    tableName: "flood_zones",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(flood_zone_code, '') AS flood_zone_code",
      "COALESCE(flood_zone_label, '') AS flood_zone_label"
    ],
    vectorFields: {
      feature_id: "String",
      flood_zone_code: "String",
      flood_zone_label: "String"
    }
  },
  contours: {
    name: "Contour Lines",
    tableName: "contour_lines",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(elevation_ft, 0)::float8 AS elevation_ft"
    ],
    vectorFields: {
      feature_id: "String",
      elevation_ft: "Number"
    }
  },
  zoning: {
    name: "Zoning",
    tableName: "zoning_districts",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(zoning_code, '') AS zoning_code",
      "COALESCE(zoning_label, '') AS zoning_label",
      "COALESCE(jurisdiction, '') AS jurisdiction",
      "('#' || SUBSTRING(MD5(UPPER(COALESCE(zoning_code, 'UNKNOWN'))) FOR 6)) AS zoning_color"
    ],
    vectorFields: {
      feature_id: "String",
      zoning_code: "String",
      zoning_label: "String",
      jurisdiction: "String",
      zoning_color: "String"
    }
  },
  "water-infrastructure": {
    name: "Water Infrastructure",
    tableName: "utility_infrastructure",
    geometryColumn: "geom",
    whereSql: "utility_type = 'water'",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(utility_type, '') AS utility_type",
      "COALESCE(utility_subtype, '') AS utility_subtype",
      "COALESCE(operator_name, '') AS operator_name"
    ],
    vectorFields: {
      feature_id: "String",
      utility_type: "String",
      utility_subtype: "String",
      operator_name: "String"
    }
  },
  "sewer-infrastructure": {
    name: "Sewer Infrastructure",
    tableName: "utility_infrastructure",
    geometryColumn: "geom",
    whereSql: "utility_type = 'sewer'",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(utility_type, '') AS utility_type",
      "COALESCE(utility_subtype, '') AS utility_subtype",
      "COALESCE(operator_name, '') AS operator_name"
    ],
    vectorFields: {
      feature_id: "String",
      utility_type: "String",
      utility_subtype: "String",
      operator_name: "String"
    }
  },
  "cities-etj": {
    name: "Cities / ETJ",
    tableName: "municipal_boundaries",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(boundary_type, '') AS boundary_type",
      "COALESCE(jurisdiction_name, '') AS jurisdiction_name"
    ],
    vectorFields: {
      feature_id: "String",
      boundary_type: "String",
      jurisdiction_name: "String"
    }
  },
  "opportunity-zones": {
    name: "Opportunity Zones",
    tableName: "opportunity_zones",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(zone_id, '') AS zone_id"
    ],
    vectorFields: {
      feature_id: "String",
      zone_id: "String"
    }
  },
  "oil-gas-leases": {
    name: "Oil & Gas Leases",
    tableName: "oil_gas_leases",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(lease_id, '') AS lease_id",
      "COALESCE(lease_name, '') AS lease_name",
      "COALESCE(operator_name, '') AS operator_name",
      "COALESCE(county_name, '') AS county_name",
      "COALESCE(state_code, '') AS state_code",
      "COALESCE(source_dataset, '') AS source_dataset",
      "('#' || SUBSTRING(MD5(UPPER(COALESCE(source_dataset, 'UNKNOWN'))) FOR 6)) AS source_color"
    ],
    vectorFields: {
      feature_id: "String",
      lease_id: "String",
      lease_name: "String",
      operator_name: "String",
      county_name: "String",
      state_code: "String",
      source_dataset: "String",
      source_color: "String"
    }
  },
  parcels: {
    name: "Parcels",
    tableName: "parcels",
    geometryColumn: "geom",
    propertySql: [
      "id::text AS feature_id",
      "COALESCE(parcel_key, '') AS parcel_key",
      "COALESCE(situs_address, '') AS situs_address",
      "COALESCE(owner_name, '') AS owner_name",
      "COALESCE(market_value, 0)::float8 AS market_value",
      "COALESCE(acreage, 0)::float8 AS acreage",
      "COALESCE(zoning_code, '') AS zoning_code"
    ],
    vectorFields: {
      feature_id: "String",
      parcel_key: "String",
      situs_address: "String",
      owner_name: "String",
      market_value: "Number",
      acreage: "Number",
      zoning_code: "String"
    }
  }
};

const NON_IMPLEMENTED_LAYERS = new Set(["watersheds", "address-points"]);
const VALID_LAYERS = new Set([...Object.keys(LIVE_LAYERS), ...Array.from(NON_IMPLEMENTED_LAYERS)]);

const EMPTY_TILE = Buffer.from([0x1a, 0x00]);
const TILE_EXTENT = 4096;
const TILE_BUFFER = 64;
const TILE_MIN_ZOOM = 0;
const TILE_MAX_ZOOM = 22;
const AUSTIN_BOUNDS: [number, number, number, number] = [-98.3, 29.7, -97.0, 31.0];
const AUSTIN_CENTER: [number, number, number] = [-97.75, 30.27, 10];

function parseTileCoordinate(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : null;
}

function getRouteParam(req: Request, key: string): string | null {
  const value = req.params[key];
  return typeof value === "string" ? value : null;
}

function getLayerConfig(layer: string): LiveLayerConfig | null {
  return LIVE_LAYERS[layer] ?? null;
}

function isUndefinedTableError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function resolvePublicTileBaseUrl(req: Request): string {
  const configured = env.TILE_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const protocol = req.protocol;
  const host = req.get("host");
  return `${protocol}://${host}/tiles`;
}

function buildTileSql(layer: string, config: LiveLayerConfig): string {
  const whereClause = config.whereSql ? `AND (${config.whereSql})` : "";
  const propertySql = config.propertySql.length > 0 ? `${config.propertySql.join(",\n          ")},` : "";

  return `
    WITH bounds AS (
      SELECT
        ST_TileEnvelope($1, $2, $3) AS geom_3857,
        ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS geom_4326
    ),
    mvtgeom AS (
      SELECT
        ${propertySql}
        ST_AsMVTGeom(
          ST_Transform(src.${config.geometryColumn}, 3857),
          bounds.geom_3857,
          ${TILE_EXTENT},
          ${TILE_BUFFER},
          true
        ) AS geom
      FROM ${config.tableName} src
      CROSS JOIN bounds
      WHERE src.${config.geometryColumn} IS NOT NULL
        AND ST_Intersects(src.${config.geometryColumn}, bounds.geom_4326)
        ${whereClause}
      LIMIT $4
    )
    SELECT ST_AsMVT(mvtgeom, $5, ${TILE_EXTENT}, 'geom') AS tile
    FROM mvtgeom
  `;
}

async function layerHasRows(config: LiveLayerConfig): Promise<boolean> {
  const whereClause = config.whereSql ? `AND (${config.whereSql})` : "";
  const query = `
    SELECT EXISTS (
      SELECT 1
      FROM ${config.tableName} src
      WHERE src.${config.geometryColumn} IS NOT NULL
      ${whereClause}
      LIMIT 1
    ) AS has_rows
  `;
  try {
    const result = await pool.query(query);
    return Boolean(result.rows[0]?.has_rows);
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return false;
    }
    throw error;
  }
}

tilesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const liveLayerEntries = Object.entries(LIVE_LAYERS);
    const liveResults = await Promise.all(
      liveLayerEntries.map(async ([key, config]) => {
        const available = await layerHasRows(config);
        return {
          key,
          mode: "postgis-live",
          available
        };
      })
    );

    const nonImplementedResults = Array.from(NON_IMPLEMENTED_LAYERS).map((key) => ({
      key,
      mode: "not-implemented",
      available: false
    }));

    res.json({
      tileMode: "postgis-live",
      tileUrlTemplate: `${resolvePublicTileBaseUrl(req)}/{layer}/{z}/{x}/{y}.pbf`,
      layers: [...liveResults, ...nonImplementedResults]
    });
  })
);

tilesRouter.get(
  "/:layer/metadata.json",
  asyncHandler(async (req, res) => {
    const layer = getRouteParam(req, "layer");
    if (!layer) {
      res.status(400).json({ error: "Layer is required" });
      return;
    }
    if (!VALID_LAYERS.has(layer)) {
      res.status(404).json({ error: "Layer not found" });
      return;
    }

    const config = getLayerConfig(layer);
    if (!config) {
      res.status(404).json({ error: "Layer metadata not available" });
      return;
    }

    const metadata = {
      tilejson: "3.0.0",
      name: config.name,
      description: `${config.name} live tiles from EmpowerGIS PostGIS`,
      scheme: "xyz",
      format: "pbf",
      minzoom: TILE_MIN_ZOOM,
      maxzoom: TILE_MAX_ZOOM,
      bounds: AUSTIN_BOUNDS,
      center: AUSTIN_CENTER,
      tiles: [`${resolvePublicTileBaseUrl(req)}/${layer}/{z}/{x}/{y}.pbf`],
      vector_layers: [
        {
          id: layer,
          fields: config.vectorFields
        }
      ]
    };

    res.set("Cache-Control", "public, max-age=3600");
    res.json(metadata);
  })
);

tilesRouter.get(
  "/:layer/:z/:x/:y.pbf",
  asyncHandler(async (req, res) => {
    const layer = getRouteParam(req, "layer");
    if (!layer) {
      res.status(400).json({ error: "Layer is required" });
      return;
    }
    if (!VALID_LAYERS.has(layer)) {
      res.status(404).json({ error: "Layer not found" });
      return;
    }

    const zRaw = getRouteParam(req, "z");
    const xRaw = getRouteParam(req, "x");
    const yRaw = getRouteParam(req, "y");
    if (!zRaw || !xRaw || !yRaw) {
      res.status(400).json({ error: "Tile coordinates are required" });
      return;
    }

    const z = parseTileCoordinate(zRaw);
    const x = parseTileCoordinate(xRaw);
    const y = parseTileCoordinate(yRaw);
    if (z === null || x === null || y === null) {
      res.status(400).json({ error: "Tile coordinates must be integer values" });
      return;
    }
    if (z < TILE_MIN_ZOOM || z > TILE_MAX_ZOOM) {
      res.status(400).json({ error: `Zoom must be between ${TILE_MIN_ZOOM} and ${TILE_MAX_ZOOM}` });
      return;
    }
    const maxCoordinate = (1 << z) - 1;
    if (x > maxCoordinate || y > maxCoordinate) {
      res.status(400).json({ error: "Tile x/y out of range for zoom level" });
      return;
    }

    const config = getLayerConfig(layer);
    res.set("Content-Type", "application/x-protobuf");
    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");

    if (!config) {
      res.send(EMPTY_TILE);
      return;
    }

    const tileSql = buildTileSql(layer, config);
    let tile: Buffer | null | undefined;
    try {
      const result = await pool.query(tileSql, [z, x, y, env.TILE_MAX_FEATURES, layer]);
      tile = result.rows[0]?.tile as Buffer | null | undefined;
    } catch (error) {
      if (isUndefinedTableError(error)) {
        res.send(EMPTY_TILE);
        return;
      }
      throw error;
    }

    if (!tile || tile.length === 0) {
      res.send(EMPTY_TILE);
      return;
    }

    res.send(tile);
  })
);

export default tilesRouter;
