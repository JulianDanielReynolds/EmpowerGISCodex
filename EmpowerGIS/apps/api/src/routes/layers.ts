import { Router } from "express";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/http.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { logUserActivity } from "../services/activity.js";

const layersRouter = Router();

type LayerCatalogEntry = {
  key: string;
  name: string;
  geometryType: "fill" | "line" | "mixed";
  description: string;
};

const BASE_LAYER_CATALOG: LayerCatalogEntry[] = [
  {
    key: "floodplain",
    name: "FEMA Floodplain",
    geometryType: "fill",
    description: "Special flood hazard areas and flood-risk zones."
  },
  {
    key: "contours",
    name: "Contour Lines",
    geometryType: "line",
    description: "Elevation contour lines for grading and drainage planning."
  },
  {
    key: "zoning",
    name: "Zoning",
    geometryType: "fill",
    description: "Local zoning districts and land use regulations."
  },
  {
    key: "water-infrastructure",
    name: "Water Infrastructure",
    geometryType: "line",
    description: "Water transmission mains and related infrastructure."
  },
  {
    key: "sewer-infrastructure",
    name: "Sewer Infrastructure",
    geometryType: "line",
    description: "Sewer lines, force mains, and related wastewater assets."
  },
  {
    key: "cities-etj",
    name: "Cities / ETJ",
    geometryType: "fill",
    description: "Municipal limits and extra-territorial jurisdictions."
  },
  {
    key: "opportunity-zones",
    name: "Opportunity Zone",
    geometryType: "fill",
    description: "Federal opportunity zone boundaries."
  },
  {
    key: "oil-gas-leases",
    name: "Oil & Gas Leases",
    geometryType: "mixed",
    description: "Active and historical oil and gas lease footprints."
  },
  {
    key: "parcels",
    name: "Parcels",
    geometryType: "line",
    description: "Parcel boundaries for lot-level analysis and site feasibility."
  }
];

const defaultTileBaseUrl =
  env.NODE_ENV === "development"
    ? `http://localhost:${env.PORT}/tiles`
    : "https://tiles.empowergis.com/tiles";
const tileBaseUrl = (env.TILE_BASE_URL ?? defaultTileBaseUrl).replace(/\/$/, "");

function canonicalLayerKey(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (normalized === "flood-zones") return "floodplain";
  if (normalized === "opportunity-zones") return "opportunity-zones";
  return normalized;
}

layersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const versionResult = await pool.query(
      `
        SELECT DISTINCT ON (layer_key)
          layer_key,
          layer_name,
          source_name,
          source_snapshot_date,
          imported_at
        FROM data_layer_versions
        ORDER BY layer_key, imported_at DESC
      `
    );

    const latestByLayer = new Map<string, {
      layerName: string;
      sourceName: string;
      sourceSnapshotDate: string | null;
      importedAt: string;
    }>();

    for (const row of versionResult.rows) {
      const key = canonicalLayerKey(row.layer_key as string);
      if (latestByLayer.has(key)) continue;
      latestByLayer.set(key, {
        layerName: row.layer_name as string,
        sourceName: row.source_name as string,
        sourceSnapshotDate: row.source_snapshot_date as string | null,
        importedAt: row.imported_at as string
      });
    }

    const layers = BASE_LAYER_CATALOG.map((layer) => {
      const latest = latestByLayer.get(layer.key);
      const status = latest ? "ready" : "missing";
      const versionParam = latest?.importedAt ? `?v=${encodeURIComponent(latest.importedAt)}` : "";

      return {
        ...layer,
        status,
        latestVersion: latest ?? null,
        tileTemplate: `${tileBaseUrl}/${layer.key}/{z}/{x}/{y}.pbf${versionParam}`
      };
    });

    await logUserActivity("layers_catalog_viewed", { count: layers.length }, req.auth.userId);

    res.json({
      region: "austin-metro",
      layers
    });
  })
);

export default layersRouter;
