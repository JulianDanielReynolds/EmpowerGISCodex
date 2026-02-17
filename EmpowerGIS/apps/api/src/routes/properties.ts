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

const parcelKeyParamsSchema = z.object({
  parcelKey: z.string().trim().min(1).max(160)
});

function normalizeAcreageValue(acreage: number | null, _countyName?: string | null): number | null {
  if (acreage === null || acreage === undefined || Number.isNaN(acreage)) {
    return null;
  }

  const parsed = Number(acreage);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(parsed.toFixed(4));
}

const ADDRESS_TOKEN_EXPANSIONS: Record<string, string> = {
  N: "North",
  S: "South",
  E: "East",
  W: "West",
  NE: "Northeast",
  NW: "Northwest",
  SE: "Southeast",
  SW: "Southwest",
  ST: "Street",
  RD: "Road",
  DR: "Drive",
  AVE: "Avenue",
  BLVD: "Boulevard",
  LN: "Lane",
  CT: "Court",
  CIR: "Circle",
  PL: "Place",
  PKWY: "Parkway",
  HWY: "Highway",
  TRL: "Trail",
  SQ: "Square",
  TER: "Terrace",
  WAY: "Way",
  TX: "Texas"
};

function toTitleCaseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/(^|[-/'])\p{L}/gu, (match) => match.toUpperCase());
}

function formatPropertyAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const compact = address.trim().replace(/\s+/g, " ");
  if (!compact) return null;

  const tokens = compact.split(" ");
  const formatted = tokens.map((token) => {
    const upper = token.toUpperCase();
    const expanded = ADDRESS_TOKEN_EXPANSIONS[upper];
    if (expanded) {
      return expanded;
    }

    if (/^\d{5}(?:-\d{4})?$/.test(token) || /^\d+[A-Za-z]?$/.test(token)) {
      return token.toUpperCase();
    }

    if (/^[A-Za-z0-9][A-Za-z0-9'/-]*$/.test(token)) {
      return toTitleCaseWord(token);
    }

    return token;
  });

  return formatted.join(" ");
}

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
        ),
        candidate AS (
          SELECT
            p.*
          FROM parcels p
          CROSS JOIN point pt
          WHERE
            ST_Intersects(p.geom, pt.geom)
            OR ST_DWithin(p.geom, pt.geom, 0.00025)
          ORDER BY
            CASE
              WHEN ST_Intersects(p.geom, pt.geom) THEN 0
              ELSE 1
            END ASC,
            ST_Distance(ST_PointOnSurface(p.geom), pt.geom) ASC,
            ST_Area(p.geom) ASC
          LIMIT 1
        )
        SELECT
          p.parcel_key,
          COALESCE(NULLIF(ap.address_label, ''), NULLIF(p.situs_address, '')) AS situs_address,
          p.owner_name,
          p.owner_mailing_address,
          p.legal_description,
          p.acreage,
          p.county_name,
          p.land_value,
          p.improvement_value,
          p.market_value,
          COALESCE(NULLIF(p.zoning_code, ''), z.zoning_code) AS zoning_code
        FROM candidate p
        CROSS JOIN point pt
        LEFT JOIN LATERAL (
          SELECT zd.zoning_code
          FROM zoning_districts zd
          WHERE ST_Intersects(zd.geom, pt.geom)
          LIMIT 1
        ) z ON TRUE
        LEFT JOIN LATERAL (
          SELECT ap.address_label
          FROM address_points ap
          WHERE
            ST_Intersects(ap.geom, p.geom)
            OR ST_DWithin(ap.geom, ST_PointOnSurface(p.geom), 0.003)
          ORDER BY
            CASE
              WHEN ST_Intersects(ap.geom, p.geom) THEN 0
              ELSE 1
            END ASC,
            ST_Distance(ap.geom, ST_PointOnSurface(p.geom)) ASC
          LIMIT 1
        ) ap ON TRUE
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
      address: formatPropertyAddress(row.situs_address) ?? "Address unavailable",
      ownerName: row.owner_name ?? "Unknown",
      ownerAddress: formatPropertyAddress(row.owner_mailing_address),
      legalDescription: row.legal_description ?? "",
      acreage: normalizeAcreageValue(row.acreage, row.county_name),
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
  "/by-parcel-key/:parcelKey",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = parcelKeyParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid parcel key", details: parsed.error.issues });
      return;
    }

    const parcelKey = parsed.data.parcelKey;
    const result = await pool.query(
      `
        SELECT
          p.parcel_key,
          COALESCE(NULLIF(ap.address_label, ''), NULLIF(p.situs_address, '')) AS situs_address,
          p.owner_name,
          p.owner_mailing_address,
          p.legal_description,
          p.acreage,
          p.county_name,
          p.land_value,
          p.improvement_value,
          p.market_value,
          COALESCE(NULLIF(p.zoning_code, ''), z.zoning_code) AS zoning_code,
          ST_X(ST_PointOnSurface(p.geom)) AS longitude,
          ST_Y(ST_PointOnSurface(p.geom)) AS latitude
        FROM parcels p
        LEFT JOIN LATERAL (
          SELECT zd.zoning_code
          FROM zoning_districts zd
          WHERE ST_Intersects(zd.geom, p.geom)
          LIMIT 1
        ) z ON TRUE
        LEFT JOIN LATERAL (
          SELECT ap.address_label
          FROM address_points ap
          WHERE
            ST_Intersects(ap.geom, p.geom)
            OR ST_DWithin(ap.geom, ST_PointOnSurface(p.geom), 0.003)
          ORDER BY
            CASE
              WHEN ST_Intersects(ap.geom, p.geom) THEN 0
              ELSE 1
            END ASC,
            ST_Distance(ap.geom, ST_PointOnSurface(p.geom)) ASC
          LIMIT 1
        ) ap ON TRUE
        WHERE UPPER(p.parcel_key) = UPPER($1)
        LIMIT 1
      `,
      [parcelKey]
    );

    if (result.rowCount === 0) {
      await logUserActivity("property_lookup_miss", { parcelKey }, req.auth.userId);
      res.status(404).json({ error: "Parcel not found" });
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
      longitude: number;
      latitude: number;
    };

    await logUserActivity(
      "property_lookup_hit",
      {
        parcelKey: row.parcel_key,
        source: "parcel_key"
      },
      req.auth.userId
    );

    res.json({
      parcelKey: row.parcel_key,
      address: formatPropertyAddress(row.situs_address) ?? "Address unavailable",
      ownerName: row.owner_name ?? "Unknown",
      ownerAddress: formatPropertyAddress(row.owner_mailing_address),
      legalDescription: row.legal_description ?? "",
      acreage: normalizeAcreageValue(row.acreage, row.county_name),
      zoning: row.zoning_code ?? "Not mapped",
      county: row.county_name,
      landValue: row.land_value === null ? null : Number(row.land_value),
      improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
      marketValue: row.market_value === null ? null : Number(row.market_value),
      coordinates: {
        longitude: Number(row.longitude),
        latitude: Number(row.latitude)
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

    const rawQuery = parsed.data.q.trim();
    const normalizedQuery = rawQuery.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    const stopWords = new Set([
      "st",
      "street",
      "rd",
      "road",
      "dr",
      "drive",
      "ave",
      "avenue",
      "blvd",
      "boulevard",
      "ln",
      "lane",
      "ct",
      "court",
      "cir",
      "circle",
      "trl",
      "trail",
      "austin",
      "tx",
      "texas",
      "apt",
      "unit",
      "suite",
      "ste"
    ]);
    const normalizedTokens = normalizedQuery
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const primaryTokens = normalizedTokens.filter((token) => !stopWords.has(token));
    const tokenPatternSeed = primaryTokens.length > 0 ? primaryTokens : normalizedTokens;
    const streetOnlyTokenSeed = tokenPatternSeed.filter(
      (token, index) => !(index === 0 && /^\d+[a-z]?$/i.test(token))
    );

    const wildcard = `%${rawQuery}%`;
    const prefix = `${rawQuery}%`;
    const normalizedWildcard = `%${normalizedQuery}%`;
    const tokenWildcard =
      tokenPatternSeed.length > 0 ? `%${tokenPatternSeed.slice(0, 5).join("%")}%` : normalizedWildcard;
    const streetOnlyWildcard =
      streetOnlyTokenSeed.length > 0 ? `%${streetOnlyTokenSeed.slice(0, 5).join("%")}%` : normalizedWildcard;
    const normalizedPrefix = `${normalizedQuery}%`;

    const result = await pool.query(
      `
        WITH parcel_seed AS MATERIALIZED (
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) = $6
            LIMIT 120
          )
          UNION ALL
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) LIKE $7
            LIMIT 220
          )
          UNION ALL
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) ILIKE $3
              OR LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) ILIKE $4
              OR LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) ILIKE $8
            LIMIT 720
          )
          UNION ALL
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) ILIKE $3
            LIMIT 360
          )
          UNION ALL
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) LIKE $7
            LIMIT 220
          )
          UNION ALL
          (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
              ST_X(ST_PointOnSurface(p.geom)) AS longitude,
              ST_Y(ST_PointOnSurface(p.geom)) AS latitude,
              LOWER(REGEXP_REPLACE(COALESCE(p.situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
              LOWER(REGEXP_REPLACE(COALESCE(p.owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_owner,
              LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_parcel_key
            FROM parcels p
            WHERE LOWER(REGEXP_REPLACE(p.parcel_key, '[^A-Za-z0-9]+', ' ', 'g')) ILIKE $3
            LIMIT 220
          )
        ),
        parcel_prepared AS (
          SELECT DISTINCT ON (parcel_key)
            parcel_key,
            situs_address,
            owner_name,
            county_name,
            acreage,
            market_value,
            zoning_code,
            longitude,
            latitude,
            normalized_address,
            normalized_owner,
            normalized_parcel_key
          FROM parcel_seed
          ORDER BY parcel_key, market_value DESC NULLS LAST
        ),
        parcel_ranked AS (
          SELECT
            parcel_key,
            situs_address,
            owner_name,
            county_name,
            acreage,
            market_value,
            zoning_code,
            longitude,
            latitude,
            parcel_key AS dedupe_key,
            0::int AS source_rank,
            CASE
              WHEN normalized_address = $6 THEN 0
              WHEN normalized_address LIKE $7 THEN 1
              WHEN normalized_parcel_key LIKE $7 THEN 2
              WHEN situs_address ILIKE $2 THEN 3
              WHEN normalized_address ILIKE $3 THEN 4
              WHEN normalized_address ILIKE $8 THEN 5
              WHEN normalized_address ILIKE $4 THEN 6
              WHEN normalized_parcel_key ILIKE $3 THEN 7
              WHEN owner_name ILIKE $2 OR normalized_owner ILIKE $3 THEN 8
              ELSE 9
            END AS relevance_bucket,
            (
              CASE WHEN normalized_address = $6 THEN 10 ELSE 0 END +
              CASE WHEN normalized_address LIKE $7 THEN 7 ELSE 0 END +
              CASE WHEN normalized_address ILIKE $3 THEN 4 ELSE 0 END +
              CASE WHEN normalized_address ILIKE $8 THEN 3 ELSE 0 END +
              CASE WHEN normalized_address ILIKE $4 THEN 3 ELSE 0 END +
              CASE WHEN normalized_parcel_key ILIKE $3 THEN 2 ELSE 0 END +
              CASE WHEN normalized_owner ILIKE $3 THEN 1 ELSE 0 END
            ) AS relevance_score
          FROM parcel_prepared
        ),
        address_seed AS MATERIALIZED (
          (
            SELECT
              ap.id AS address_point_id,
              ap.address_label,
              ap.normalized_address,
              ap.county_name,
              ap.geom
            FROM address_points ap
            WHERE ap.normalized_address = $6
            LIMIT 120
          )
          UNION ALL
          (
            SELECT
              ap.id AS address_point_id,
              ap.address_label,
              ap.normalized_address,
              ap.county_name,
              ap.geom
            FROM address_points ap
            WHERE ap.normalized_address LIKE $7
            LIMIT 220
          )
          UNION ALL
          (
            SELECT
              ap.id AS address_point_id,
              ap.address_label,
              ap.normalized_address,
              ap.county_name,
              ap.geom
            FROM address_points ap
            WHERE
              ap.normalized_address ILIKE $3
              OR ap.normalized_address ILIKE $4
              OR ap.normalized_address ILIKE $8
            LIMIT 900
          )
        ),
        address_candidates AS (
          SELECT DISTINCT ON (
            normalized_address,
            COALESCE(county_name, ''),
            ST_X(geom),
            ST_Y(geom)
          )
            address_point_id,
            address_label,
            normalized_address,
            county_name,
            geom
          FROM address_seed
          ORDER BY
            normalized_address,
            COALESCE(county_name, ''),
            ST_X(geom),
            ST_Y(geom)
        ),
        address_ranked AS (
          SELECT
            COALESCE(p.parcel_key, CONCAT('ADDR-', ap.address_point_id::text)) AS parcel_key,
            COALESCE(NULLIF(ap.address_label, ''), NULLIF(p.situs_address, ''), 'Address unavailable') AS situs_address,
            COALESCE(NULLIF(p.owner_name, ''), 'Unknown') AS owner_name,
            COALESCE(NULLIF(p.county_name, ''), NULLIF(ap.county_name, ''), 'Unknown') AS county_name,
            p.acreage,
            p.market_value,
            COALESCE(NULLIF(p.zoning_code, ''), 'Not mapped') AS zoning_code,
            ST_X(ap.geom) AS longitude,
            ST_Y(ap.geom) AS latitude,
            COALESCE(p.parcel_key, CONCAT('ADDR-', ap.address_point_id::text)) AS dedupe_key,
            1::int AS source_rank,
            CASE
              WHEN ap.normalized_address = $6 THEN 0
              WHEN ap.normalized_address LIKE $7 THEN 1
              WHEN ap.address_label ILIKE $2 THEN 2
              WHEN ap.normalized_address ILIKE $3 THEN 3
              WHEN ap.normalized_address ILIKE $8 THEN 4
              WHEN ap.normalized_address ILIKE $4 THEN 5
              ELSE 6
            END AS relevance_bucket,
            (
              CASE WHEN ap.normalized_address = $6 THEN 10 ELSE 0 END +
              CASE WHEN ap.normalized_address LIKE $7 THEN 7 ELSE 0 END +
              CASE WHEN ap.normalized_address ILIKE $3 THEN 4 ELSE 0 END +
              CASE WHEN ap.normalized_address ILIKE $8 THEN 3 ELSE 0 END +
              CASE WHEN ap.normalized_address ILIKE $4 THEN 2 ELSE 0 END
            ) AS relevance_score
          FROM address_candidates ap
          LEFT JOIN LATERAL (
            SELECT
              p.parcel_key,
              p.situs_address,
              p.owner_name,
              p.county_name,
              p.acreage,
              p.market_value,
              p.zoning_code,
              p.geom
            FROM parcels p
            WHERE ST_DWithin(p.geom, ap.geom, 0.0012)
            ORDER BY ST_Distance(ST_PointOnSurface(p.geom), ap.geom) ASC
            LIMIT 1
          ) p ON TRUE
        ),
        combined AS (
          SELECT * FROM parcel_ranked
          UNION ALL
          SELECT * FROM address_ranked
        ),
        deduped AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY dedupe_key
              ORDER BY
                relevance_bucket ASC,
                relevance_score DESC,
                source_rank ASC,
                market_value DESC NULLS LAST,
                parcel_key ASC
            ) AS dedupe_rank
          FROM combined
        )
        SELECT
          parcel_key,
          situs_address,
          owner_name,
          county_name,
          acreage,
          market_value,
          zoning_code,
          longitude,
          latitude
        FROM deduped
        WHERE dedupe_rank = 1
        ORDER BY
          relevance_bucket ASC,
          relevance_score DESC,
          source_rank ASC,
          market_value DESC NULLS LAST,
          parcel_key ASC
        LIMIT $5
      `,
      [wildcard, prefix, normalizedWildcard, tokenWildcard, parsed.data.limit, normalizedQuery, normalizedPrefix, streetOnlyWildcard]
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
        address: formatPropertyAddress(row.situs_address) ?? "Address unavailable",
        ownerName: row.owner_name ?? "Unknown",
        county: row.county_name,
        acreage: normalizeAcreageValue(row.acreage, row.county_name),
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
          county_name,
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
          acreage: normalizeAcreageValue(row.acreage, row.county_name),
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
          COALESCE(SUM(COALESCE(acreage, 0)), 0)::numeric(16,2) AS total_acreage
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
