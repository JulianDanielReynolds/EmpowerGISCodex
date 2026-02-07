import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import { asyncHandler } from "../lib/http.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { logUserActivity } from "../services/activity.js";

const propertiesRouter = Router();

const coordinateQuerySchema = z.object({
  longitude: z.coerce.number().gte(-180).lte(180),
  latitude: z.coerce.number().gte(-90).lte(90)
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const boundsQuerySchema = z.object({
  west: z.coerce.number().gte(-180).lte(180),
  south: z.coerce.number().gte(-90).lte(90),
  east: z.coerce.number().gte(-180).lte(180),
  north: z.coerce.number().gte(-90).lte(90),
  limit: z.coerce.number().int().min(1).max(2_000).default(800)
});

propertiesRouter.get(
  "/by-coordinates",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = coordinateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid coordinates", details: parsed.error.issues });
      return;
    }

    const { longitude, latitude } = parsed.data;
    const result = await pool.query(
      `
        WITH point AS (
          SELECT ST_SetSRID(ST_Point($1, $2), 4326) AS geom
        )
        SELECT
          p.parcel_key,
          p.situs_address,
          p.owner_name,
          p.owner_mailing_address,
          p.legal_description,
          p.acreage,
          p.county_name,
          p.land_value,
          p.improvement_value,
          p.market_value,
          COALESCE(NULLIF(p.zoning_code, ''), z.zoning_code) AS zoning_code
        FROM parcels p
        CROSS JOIN point pt
        LEFT JOIN LATERAL (
          SELECT zd.zoning_code
          FROM zoning_districts zd
          WHERE ST_Intersects(zd.geom, pt.geom)
          LIMIT 1
        ) z ON TRUE
        WHERE ST_Intersects(p.geom, pt.geom)
        ORDER BY ST_Area(p.geom) ASC
        LIMIT 1
      `,
      [longitude, latitude]
    );

    if (result.rowCount === 0) {
      await logUserActivity(
        "property_lookup_miss",
        { longitude, latitude },
        req.auth.userId
      );
      res.status(404).json({ error: "No parcel found at this location" });
      return;
    }

    const row = result.rows[0] as {
      parcel_key: string;
      situs_address: string | null;
      owner_name: string | null;
      owner_mailing_address: string | null;
      legal_description: string | null;
      acreage: number | null;
      county_name: string | null;
      land_value: number | null;
      improvement_value: number | null;
      market_value: number | null;
      zoning_code: string | null;
    };

    await logUserActivity(
      "property_lookup_hit",
      {
        parcelKey: row.parcel_key,
        longitude,
        latitude
      },
      req.auth.userId
    );

    res.json({
      parcelKey: row.parcel_key,
      address: row.situs_address ?? "Address unavailable",
      ownerName: row.owner_name ?? "Unknown",
      ownerAddress: row.owner_mailing_address,
      legalDescription: row.legal_description ?? "",
      acreage: row.acreage === null ? null : Number(row.acreage),
      zoning: row.zoning_code ?? "Not mapped",
      county: row.county_name,
      landValue: row.land_value === null ? null : Number(row.land_value),
      improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
      marketValue: row.market_value === null ? null : Number(row.market_value),
      coordinates: {
        longitude,
        latitude
      }
    });
  })
);

propertiesRouter.get(
  "/search",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid search query", details: parsed.error.issues });
      return;
    }

    const wildcard = `%${parsed.data.q}%`;
    const prefix = `${parsed.data.q}%`;
    const result = await pool.query(
      `
        SELECT
          parcel_key,
          situs_address,
          owner_name,
          county_name,
          acreage,
          market_value,
          COALESCE(NULLIF(zoning_code, ''), 'Not mapped') AS zoning_code,
          ST_X(ST_PointOnSurface(geom)) AS longitude,
          ST_Y(ST_PointOnSurface(geom)) AS latitude
        FROM parcels
        WHERE
          parcel_key ILIKE $1
          OR situs_address ILIKE $1
          OR owner_name ILIKE $1
        ORDER BY
          CASE
            WHEN parcel_key ILIKE $2 THEN 0
            WHEN situs_address ILIKE $2 THEN 1
            ELSE 2
          END,
          market_value DESC NULLS LAST,
          parcel_key ASC
        LIMIT $3
      `,
      [wildcard, prefix, parsed.data.limit]
    );

    await logUserActivity(
      "property_search",
      {
        query: parsed.data.q,
        resultCount: result.rowCount
      },
      req.auth.userId
    );

    res.json({
      count: result.rowCount,
      results: result.rows.map((row) => ({
        parcelKey: row.parcel_key,
        address: row.situs_address ?? "Address unavailable",
        ownerName: row.owner_name ?? "Unknown",
        county: row.county_name,
        acreage: row.acreage === null ? null : Number(row.acreage),
        marketValue: row.market_value === null ? null : Number(row.market_value),
        zoning: row.zoning_code,
        longitude: Number(row.longitude),
        latitude: Number(row.latitude)
      }))
    });
  })
);

propertiesRouter.get(
  "/bounds",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = boundsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid bounds query", details: parsed.error.issues });
      return;
    }

    const { west, south, east, north, limit } = parsed.data;
    if (west >= east || south >= north) {
      res.status(400).json({ error: "Invalid bounds: west/east or south/north order is incorrect" });
      return;
    }

    const result = await pool.query(
      `
        WITH bounds AS (
          SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom
        )
        SELECT
          parcel_key,
          situs_address,
          owner_name,
          acreage,
          market_value,
          ST_AsGeoJSON(geom)::json AS geometry
        FROM parcels p
        CROSS JOIN bounds b
        WHERE ST_Intersects(p.geom, b.geom)
        LIMIT $5
      `,
      [west, south, east, north, limit]
    );

    res.json({
      type: "FeatureCollection",
      featureCount: result.rowCount,
      features: result.rows.map((row) => ({
        type: "Feature",
        properties: {
          parcelKey: row.parcel_key,
          address: row.situs_address,
          ownerName: row.owner_name,
          acreage: row.acreage,
          marketValue: row.market_value
        },
        geometry: row.geometry
      }))
    });
  })
);

propertiesRouter.get(
  "/stats",
  requireAuth,
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const result = await pool.query(
      `
        SELECT
          COUNT(*)::bigint AS total_parcels,
          COUNT(DISTINCT county_fips)::int AS county_count,
          COALESCE(SUM(market_value), 0)::numeric(16,2) AS total_market_value,
          COALESCE(AVG(market_value), 0)::numeric(16,2) AS avg_market_value,
          COALESCE(SUM(acreage), 0)::numeric(16,2) AS total_acreage
        FROM parcels
      `
    );

    const row = result.rows[0] as {
      total_parcels: string;
      county_count: number;
      total_market_value: string;
      avg_market_value: string;
      total_acreage: string;
    };

    res.json({
      totalParcels: Number(row.total_parcels),
      countyCount: row.county_count,
      totalMarketValue: Number(row.total_market_value),
      averageMarketValue: Number(row.avg_market_value),
      totalAcreage: Number(row.total_acreage)
    });
  })
);

export default propertiesRouter;
