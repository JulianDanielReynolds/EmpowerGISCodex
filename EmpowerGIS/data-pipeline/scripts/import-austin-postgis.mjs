import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

function parseArgs(argv) {
  const args = {
    layers: null,
    bbox: null,
    skipParcels: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--layers=")) {
      args.layers = arg.slice("--layers=".length).split(",").map((v) => v.trim()).filter(Boolean);
    } else if (arg.startsWith("--bbox=")) {
      const raw = arg.slice("--bbox=".length).split(",").map((v) => Number(v.trim()));
      if (raw.length !== 4 || raw.some((v) => Number.isNaN(v))) {
        throw new Error("Invalid --bbox format. Expected: --bbox=west,south,east,north");
      }
      args.bbox = {
        west: raw[0],
        south: raw[1],
        east: raw[2],
        north: raw[3]
      };
    } else if (arg === "--skip-parcels") {
      args.skipParcels = true;
    }
  }

  return args;
}

function getDatabaseUrl() {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;

  const fallbackApiEnv = path.resolve(process.cwd(), "../apps/api/.env");
  if (fs.existsSync(fallbackApiEnv)) {
    const file = fs.readFileSync(fallbackApiEnv, "utf8");
    const match = file.match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  }

  throw new Error("DATABASE_URL not found. Export DATABASE_URL or create apps/api/.env");
}

function toOgrPgConnectionString(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const dbname = parsed.pathname.replace(/^\//, "");
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  return `PG:host=${host} port=${port} dbname=${dbname} user=${user} password=${password}`;
}

function runCommand(command, args, opts = {}) {
  const rendered = [command, ...args].join(" ");
  console.log(`\n$ ${rendered}`);
  execFileSync(command, args, {
    stdio: "inherit",
    ...opts
  });
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }
}

const LEGACY_SOURCE_ROOT = "/Users/julianreynolds/austin-gis-platform/data/raw";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PROJECT_SOURCE_ROOT = path.resolve(REPO_ROOT, "data", "raw");

function resolveSourceRoot() {
  const candidates = [process.env.DATA_SOURCE_ROOT, PROJECT_SOURCE_ROOT, LEGACY_SOURCE_ROOT].filter(Boolean);
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? candidates[0];
}

const SOURCE_ROOT = resolveSourceRoot();

const IMPORT_PLAN = [
  {
    key: "floodplain",
    name: "FEMA Floodplain",
    targetTable: "flood_zones",
    stagingTable: "staging_floodplain",
    sources: [
      `${SOURCE_ROOT}/flood-zones/fema_austin_metro_floodplain.geojson`
    ],
    transformSql: (versionId) => `
      INSERT INTO flood_zones (
        flood_zone_code,
        flood_zone_label,
        layer_version_id,
        geom
      )
      SELECT
        NULLIF(flood_zone::text, '') AS flood_zone_code,
        CASE
          WHEN COALESCE(NULLIF(flood_zone::text, ''), '') = '' THEN 'Unspecified Flood Zone'
          ELSE flood_zone::text
        END AS flood_zone_label,
        ${versionId},
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326)
      FROM staging_floodplain
      WHERE geom IS NOT NULL;
    `
  },
  {
    key: "contours",
    name: "Austin Contours",
    targetTable: "contour_lines",
    stagingTable: "staging_contours",
    sources: [
      `${SOURCE_ROOT}/contours/austin_east_contours.geojson`,
      `${SOURCE_ROOT}/contours/austin_west_contours.geojson`
    ],
    transformSql: (versionId) => `
      INSERT INTO contour_lines (
        elevation_ft,
        layer_version_id,
        geom
      )
      SELECT
        NULLIF(contourele::text, '')::numeric(10,2) AS elevation_ft,
        ${versionId},
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 2))::geometry(MULTILINESTRING, 4326)
      FROM staging_contours
      WHERE geom IS NOT NULL;
    `
  },
  {
    key: "zoning",
    name: "Austin Metro Zoning",
    targetTable: "zoning_districts",
    stagingTable: "staging_zoning",
    sources: [
      `${SOURCE_ROOT}/zoning/austin_zoning_small_scale.geojson`,
      `${SOURCE_ROOT}/zoning/Zoning_Districts.geojson`,
      `${SOURCE_ROOT}/zoning/Current_Zoning.geojson`,
      `${SOURCE_ROOT}/zoning/Zoning_Overlay.geojson`,
      `${SOURCE_ROOT}/zoning/Zoning_Overlays.geojson`
    ],
    transformSql: (versionId) => `
      INSERT INTO zoning_districts (
        zoning_code,
        zoning_label,
        jurisdiction,
        layer_version_id,
        geom
      )
      SELECT
        UPPER(
          TRIM(
            COALESCE(
              NULLIF(zoning_ztype::text, ''),
              NULLIF(zoning_base::text, ''),
              NULLIF(zoning_category::text, ''),
              NULLIF(zoining_ty::text, ''),
              NULLIF(overlay::text, ''),
              NULLIF(overlay_ty::text, ''),
              'UNKNOWN'
            )
          )
        ) AS zoning_code,
        COALESCE(
          NULLIF(zoning_description::text, ''),
          NULLIF(zoning_des::text, ''),
          NULLIF(land_use::text, ''),
          CASE
            WHEN NULLIF(overlay_ty::text, '') IS NOT NULL THEN overlay_ty::text
            WHEN NULLIF(overlay::text, '') IS NOT NULL THEN CONCAT('Overlay ', overlay::text)
            ELSE NULL
          END,
          NULLIF(zoning_category::text, ''),
          NULLIF(zoining_ty::text, ''),
          NULLIF(zoning_ztype::text, ''),
          NULLIF(zoning_base::text, ''),
          'Unknown Zoning'
        ) AS zoning_label,
        CASE
          WHEN COALESCE(NULLIF(zoning_ztype::text, ''), NULLIF(zoning_base::text, '')) IS NOT NULL
            THEN 'City of Austin'
          WHEN COALESCE(
            NULLIF(zoning_category::text, ''),
            NULLIF(zoining_ty::text, ''),
            NULLIF(overlay::text, ''),
            NULLIF(overlay_ty::text, '')
          ) IS NOT NULL
            THEN 'City of Pflugerville'
          ELSE 'Austin Metro'
        END AS jurisdiction,
        ${versionId},
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326)
      FROM staging_zoning
      WHERE geom IS NOT NULL;
    `
  },
  {
    key: "water-infrastructure",
    name: "Water Infrastructure",
    targetTable: "utility_infrastructure",
    stagingTable: "staging_water",
    sources: [
      `${SOURCE_ROOT}/water/Water_Transmission_Main.geojson`,
      `${SOURCE_ROOT}/water/round_rock_water_service_lines.geojson`
    ],
    transformSql: (versionId) => `
      INSERT INTO utility_infrastructure (
        utility_type,
        utility_subtype,
        operator_name,
        layer_version_id,
        geom
      )
      SELECT
        'water' AS utility_type,
        COALESCE(NULLIF(material::text, ''), NULLIF(size::text, ''), 'water_asset') AS utility_subtype,
        COALESCE(NULLIF(owner::text, ''), NULLIF(ownedby::text, ''), 'unknown') AS operator_name,
        ${versionId},
        ST_MakeValid(ST_Force2D(geom))::geometry(GEOMETRY, 4326)
      FROM staging_water
      WHERE geom IS NOT NULL;
    `
  },
  {
    key: "sewer-infrastructure",
    name: "Sewer Infrastructure",
    targetTable: "utility_infrastructure",
    stagingTable: "staging_sewer",
    sources: [
      `${SOURCE_ROOT}/sewer/Forcemain.geojson`,
      `${SOURCE_ROOT}/sewer/Wastewater_Manhole.geojson`,
      `${SOURCE_ROOT}/sewer/WW_Collection_System_7024763302870928540.geojson`,
      `${SOURCE_ROOT}/sewer/Wastewater_Collection_System_8716600646372745612.geojson`,
      `${SOURCE_ROOT}/sewer/Wastewater_Collection_System_2007308926558367924.geojson`
    ],
    transformSql: (versionId) => `
      WITH prepared AS (
        SELECT
          to_jsonb(staging_sewer) AS props,
          ST_MakeValid(ST_Force2D(geom))::geometry(GEOMETRY, 4326) AS geom
        FROM staging_sewer
        WHERE geom IS NOT NULL
      )
      INSERT INTO utility_infrastructure (
        utility_type,
        utility_subtype,
        operator_name,
        layer_version_id,
        geom
      )
      SELECT
        'sewer' AS utility_type,
        COALESCE(
          NULLIF(props->>'type', ''),
          NULLIF(props->>'type_d', ''),
          NULLIF(props->>'use_d', ''),
          NULLIF(props->>'material', ''),
          NULLIF(props->>'mat_d', ''),
          NULLIF(props->>'mh_dia', ''),
          'sewer_asset'
        ) AS utility_subtype,
        COALESCE(
          NULLIF(props->>'ownership', ''),
          NULLIF(props->>'owner', ''),
          NULLIF(props->>'owner_id', ''),
          NULLIF(props->>'ownerid', ''),
          'unknown'
        ) AS operator_name,
        ${versionId},
        geom
      FROM prepared;
    `
  },
  {
    key: "address-points",
    name: "Address Points",
    targetTable: "address_points",
    stagingTable: "staging_address_points",
    sources: [
      `${SOURCE_ROOT}/address-points/stratmap25-addresspoints_48.gdb`
    ],
    transformSql: (versionId) => `
      WITH staged AS (
        SELECT
          to_jsonb(staging_address_points) AS props,
          ST_SetSRID(ST_PointOnSurface(ST_MakeValid(ST_Force2D(geom))), 4326)::geometry(POINT, 4326) AS geom
        FROM staging_address_points
        WHERE geom IS NOT NULL
      ),
      extracted AS (
        SELECT
          COALESCE(
            NULLIF(props->>'full_addr', ''),
            NULLIF(props->>'full_address', ''),
            NULLIF(props->>'label_name_unit', ''),
            NULLIF(props->>'label_name', ''),
            NULLIF(TRIM(CONCAT_WS(' ',
              NULLIF(props->>'addr_num', ''),
              NULLIF(props->>'addr_number', ''),
              NULLIF(props->>'add_number', ''),
              NULLIF(props->>'addnum_suf', ''),
              NULLIF(props->>'st_predir', ''),
              NULLIF(props->>'st_pretyp', ''),
              NULLIF(props->>'st_name', ''),
              NULLIF(props->>'st_postyp', ''),
              NULLIF(props->>'st_posdir', ''),
              NULLIF(props->>'st_premod', ''),
              NULLIF(props->>'st_posmod', ''),
              NULLIF(props->>'st_type', ''),
              NULLIF(props->>'rd_fullname', ''),
              NULLIF(props->>'unit', '')
            )), '')
          ) AS address_label,
          COALESCE(
            NULLIF(props->>'post_comm', ''),
            NULLIF(props->>'postal_com', ''),
            NULLIF(props->>'postal_comm', ''),
            NULLIF(props->>'city', ''),
            NULLIF(props->>'msag_com', ''),
            NULLIF(props->>'municipal', '')
          ) AS city_name,
          COALESCE(NULLIF(props->>'county', ''), 'Unknown') AS county_name,
          COALESCE(NULLIF(props->>'post_code', ''), NULLIF(props->>'zip', '')) AS postal_code,
          COALESCE(NULLIF(props->>'source', ''), NULLIF(props->>'updating_agency', ''), 'unknown') AS source_name,
          geom
        FROM staged
      ),
      prepared AS (
        SELECT
          address_label,
          LOWER(REGEXP_REPLACE(address_label, '[^A-Za-z0-9]+', ' ', 'g')) AS normalized_address,
          city_name,
          county_name,
          postal_code,
          source_name,
          geom
        FROM extracted
        WHERE COALESCE(TRIM(address_label), '') <> ''
      ),
      deduped AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY normalized_address, county_name, ST_SnapToGrid(geom, 0.000001)
            ORDER BY source_name ASC
          ) AS rn
        FROM prepared
      )
      INSERT INTO address_points (
        address_label,
        normalized_address,
        city_name,
        county_name,
        postal_code,
        source_name,
        layer_version_id,
        geom
      )
      SELECT
        address_label,
        normalized_address,
        city_name,
        county_name,
        postal_code,
        source_name,
        ${versionId},
        geom
      FROM deduped
      WHERE rn = 1;
    `
  },
  {
    key: "cities-etj",
    name: "Cities and ETJ",
    targetTable: "municipal_boundaries",
    stagingTable: "staging_cities_etj",
    sources: [
      `${SOURCE_ROOT}/cities/williamson_cities.geojson`,
      `${SOURCE_ROOT}/cities/williamson_etj.geojson`,
      `${SOURCE_ROOT}/cities/hays_city_boundaries.geojson`,
      `${SOURCE_ROOT}/cities/hays_etj_boundaries.geojson`,
      `${SOURCE_ROOT}/cities/Municipal_Jurisdictions_Boundaries.geojson`
    ],
    transformSql: (versionId) => `
      WITH prepared AS (
        SELECT
          CASE
            WHEN NULLIF(etj_name::text, '') IS NOT NULL THEN 'etj'
            WHEN NULLIF(etj_type::text, '') IS NOT NULL THEN 'etj'
            WHEN UPPER(COALESCE(NULLIF(city_name::text, ''), NULLIF(muni_nm::text, ''))) LIKE '% ETJ%' THEN 'etj'
            WHEN UPPER(COALESCE(NULLIF(name::text, ''), NULLIF(first_label::text, ''))) LIKE '%ETJ%' THEN 'etj'
            ELSE 'city'
          END AS boundary_type_raw,
          UPPER(
            TRIM(
              COALESCE(
                NULLIF(REPLACE(etj_name::text, ' ETJ', ''), ''),
                NULLIF(city_name::text, ''),
                NULLIF(muni_nm::text, ''),
                NULLIF(REPLACE(first_label::text, ' ETJ', ''), ''),
                NULLIF(REPLACE(REGEXP_REPLACE(name::text, '^(City|Village) of ', '', 'i'), ' ETJ', ''), ''),
                'Unknown Jurisdiction'
              )
            )
          ) AS jurisdiction_name,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_cities_etj
        WHERE geom IS NOT NULL
      ),
      ranked AS (
        SELECT
          *,
          COUNT(*) OVER (PARTITION BY jurisdiction_name) AS duplicate_name_count,
          SUM(CASE WHEN boundary_type_raw = 'etj' THEN 1 ELSE 0 END)
            OVER (PARTITION BY jurisdiction_name) AS explicit_etj_count,
          ROW_NUMBER() OVER (
            PARTITION BY jurisdiction_name
            ORDER BY ST_Area(geom::geography) DESC
          ) AS area_rank
        FROM prepared
      )
      INSERT INTO municipal_boundaries (
        boundary_type,
        jurisdiction_name,
        layer_version_id,
        geom
      )
      SELECT
        CASE
          WHEN boundary_type_raw = 'etj' THEN 'etj'
          WHEN duplicate_name_count > 1 AND explicit_etj_count = 0 AND area_rank = 1 THEN 'etj'
          ELSE 'city'
        END AS boundary_type,
        jurisdiction_name,
        ${versionId},
        geom
      FROM ranked;
    `
  },
  {
    key: "opportunity-zones",
    name: "Opportunity Zones",
    targetTable: "opportunity_zones",
    stagingTable: "staging_opportunity_zones",
    sources: [
      `${SOURCE_ROOT}/opportunity-zones/Opportunity_Zones_2244808886865986276.geojson`
    ],
    transformSql: (versionId) => `
      INSERT INTO opportunity_zones (
        zone_id,
        layer_version_id,
        geom
      )
      SELECT
        COALESCE(NULLIF(geoid10::text, ''), NULLIF(objectid::text, ''), md5(ST_AsBinary(geom)::text)) AS zone_id,
        ${versionId},
        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326)
      FROM staging_opportunity_zones
      WHERE geom IS NOT NULL;
    `
  },
  {
    key: "parcels",
    name: "Austin Metro Parcels",
    targetTable: "parcels",
    stagingTable: "staging_parcels",
    sources: [
      `${SOURCE_ROOT}/parcels/travis_county_parcels.geojson`,
      `${SOURCE_ROOT}/parcels/williamson_county_parcels.geojson`,
      `${SOURCE_ROOT}/parcels/hays_county_parcels.geojson`
    ],
    transformSql: (versionId) => `
      WITH normalized AS (
        SELECT
          COALESCE(
            NULLIF(TRIM(CONCAT_WS('-', UPPER(NULLIF(county::text, '')), NULLIF(prop_id::text, ''))), ''),
            md5(ST_AsBinary(geom)::text)
          ) AS parcel_key,
          CASE UPPER(COALESCE(county::text, ''))
            WHEN 'TRAVIS' THEN '453'
            WHEN 'WILLIAMSON' THEN '491'
            WHEN 'HAYS' THEN '209'
            ELSE NULL
          END AS county_fips,
          NULLIF(county::text, '') AS county_name,
          TRIM(CONCAT_WS(' ',
            NULLIF(situs_num::text, ''),
            NULLIF(situs_st_1::text, ''),
            NULLIF(situs_city::text, ''),
            NULLIF(situs_zip::text, '')
          )) AS situs_address,
          NULLIF(owner_name::text, '') AS owner_name,
          NULLIF(legal_desc::text, '') AS legal_description,
          CASE
            WHEN UPPER(COALESCE(county::text, '')) = 'TRAVIS'
              THEN (NULLIF(gis_area::text, '')::numeric(12,4) / 10.7639104167)
            ELSE NULLIF(gis_area::text, '')::numeric(12,4)
          END AS acreage,
          NULLIF(land_value::text, '')::numeric(14,2) AS land_value,
          NULLIF(imp_value::text, '')::numeric(14,2) AS improvement_value,
          NULLIF(mkt_value::text, '')::numeric(14,2) AS market_value,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_parcels
        WHERE geom IS NOT NULL
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY parcel_key
            ORDER BY market_value DESC NULLS LAST, acreage DESC NULLS LAST
          ) AS rn
        FROM normalized
      )
      INSERT INTO parcels (
        parcel_key,
        county_fips,
        county_name,
        situs_address,
        owner_name,
        legal_description,
        acreage,
        land_value,
        improvement_value,
        market_value,
        layer_version_id,
        geom
      )
      SELECT
        parcel_key,
        county_fips,
        county_name,
        situs_address,
        owner_name,
        legal_description,
        acreage,
        land_value,
        improvement_value,
        market_value,
        ${versionId},
        geom
      FROM ranked
      WHERE rn = 1
      ON CONFLICT (parcel_key) DO UPDATE
      SET
        county_fips = EXCLUDED.county_fips,
        county_name = EXCLUDED.county_name,
        situs_address = EXCLUDED.situs_address,
        owner_name = EXCLUDED.owner_name,
        legal_description = EXCLUDED.legal_description,
        acreage = EXCLUDED.acreage,
        land_value = EXCLUDED.land_value,
        improvement_value = EXCLUDED.improvement_value,
        market_value = EXCLUDED.market_value,
        layer_version_id = EXCLUDED.layer_version_id,
        geom = EXCLUDED.geom;
    `
  }
];

function buildOgrArgs({ pgConnectionString, source, stagingTable, overwrite, bbox }) {
  const args = [
    "-f",
    "PostgreSQL",
    pgConnectionString,
    source,
    "-nln",
    stagingTable,
    overwrite ? "-overwrite" : "-append",
    "-addfields",
    "-skipfailures",
    "-makevalid",
    "-t_srs",
    "EPSG:4326",
    "-lco",
    "GEOMETRY_NAME=geom",
    "-nlt",
    "GEOMETRY",
    "-progress"
  ];

  if (bbox) {
    args.push(
      "-spat",
      String(bbox.west),
      String(bbox.south),
      String(bbox.east),
      String(bbox.north)
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = getDatabaseUrl();
  const pgConnectionString = toOgrPgConnectionString(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl });

  const selectedLayers = new Set(args.layers ?? IMPORT_PLAN.map((x) => x.key));
  if (args.skipParcels) {
    selectedLayers.delete("parcels");
  }

  const plan = IMPORT_PLAN.filter((item) => selectedLayers.has(item.key));
  if (plan.length === 0) {
    throw new Error("No layers selected for import.");
  }

  const client = await pool.connect();
  try {
    console.log(`Using source root: ${SOURCE_ROOT}`);
    console.log(`Preparing import for layers: ${plan.map((x) => x.key).join(", ")}`);
    if (args.bbox) {
      console.log(
        `Applying bbox filter: ${args.bbox.west},${args.bbox.south},${args.bbox.east},${args.bbox.north}`
      );
    }

    for (const layer of plan) {
      for (const source of layer.sources) {
        ensureFileExists(source);
      }

      console.log(`\n=== Importing layer: ${layer.key} ===`);
      await client.query("BEGIN");
      try {
        await client.query(`DELETE FROM ${layer.targetTable} WHERE layer_version_id IN (SELECT id FROM data_layer_versions WHERE layer_key = $1)`, [layer.key]);
        await client.query("DELETE FROM data_layer_versions WHERE layer_key = $1", [layer.key]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      let first = true;
      for (const source of layer.sources) {
        const ogrArgs = buildOgrArgs({
          pgConnectionString,
          source,
          stagingTable: layer.stagingTable,
          overwrite: first,
          bbox: args.bbox
        });
        runCommand("ogr2ogr", ogrArgs);
        first = false;
      }

      const versionResult = await client.query(
        `
          INSERT INTO data_layer_versions (
            layer_key,
            layer_name,
            source_name,
            source_url,
            source_snapshot_date,
            metadata
          )
          VALUES ($1, $2, $3, $4, CURRENT_DATE, $5::jsonb)
          RETURNING id
        `,
        [
          layer.key,
          layer.name,
          "Austin public GIS import",
          "https://www.empowergis.com",
          JSON.stringify({
            importedBy: "import-austin-postgis.mjs",
            sourceCount: layer.sources.length,
            bbox: args.bbox
          })
        ]
      );
      const versionId = Number(versionResult.rows[0].id);

      await client.query("BEGIN");
      try {
        await client.query(layer.transformSql(versionId));
        await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      const countResult = await client.query(
        `
          SELECT COUNT(*)::bigint AS count
          FROM ${layer.targetTable}
          WHERE layer_version_id = $1
        `,
        [versionId]
      );
      console.log(`Imported ${countResult.rows[0].count} records into ${layer.targetTable}`);
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log("\nAustin PostGIS import complete.");
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
