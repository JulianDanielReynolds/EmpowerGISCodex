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

const VECTOR_SOURCE_PATTERN = /\.(geojson|json|gpkg|shp)$/i;
const FILE_GEODATABASE_PATTERN = /\.gdb$/i;

function resolveExistingSources(relativePaths) {
  return relativePaths
    .map((relativePath) => path.join(SOURCE_ROOT, relativePath))
    .filter((sourcePath) => fs.existsSync(sourcePath));
}

function resolveDirectorySources(relativeDirectory, options = {}) {
  const {
    filePattern = VECTOR_SOURCE_PATTERN,
    directoryPattern = FILE_GEODATABASE_PATTERN,
    minFileSizeBytes = 1024
  } = options;

  const layerDir = path.join(SOURCE_ROOT, relativeDirectory);
  if (!fs.existsSync(layerDir) || !fs.statSync(layerDir).isDirectory()) {
    return [];
  }

  const sources = [];
  const entries = fs.readdirSync(layerDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(layerDir, entry.name);
    if (entry.isDirectory() && directoryPattern?.test(entry.name)) {
      sources.push(entryPath);
      continue;
    }
    if (entry.isFile() && filePattern?.test(entry.name)) {
      const fileSize = fs.statSync(entryPath).size;
      if (fileSize >= minFileSizeBytes) {
        sources.push(entryPath);
      }
    }
  }

  return sources.sort((a, b) => a.localeCompare(b));
}

function mergeUniqueSources(...sourceLists) {
  return Array.from(new Set(sourceLists.flat())).sort((a, b) => a.localeCompare(b));
}

function resolveFloodplainSources() {
  return mergeUniqueSources(
    resolveExistingSources([
      "flood-zones/fema_austin_metro_floodplain.geojson",
      "fema-flood-zones/fema_austin_metro_floodplain.geojson"
    ]),
    resolveDirectorySources("flood-zones"),
    resolveDirectorySources("fema-flood-zones")
  );
}

function resolveZoningSources() {
  return mergeUniqueSources(
    resolveExistingSources([
      "zoning/austin_zoning_small_scale.geojson",
      "zoning/Zoning_(Small_Map_Scale)_20260129.geojson",
      "zoning/Zoning_Districts.geojson",
      "zoning/Current_Zoning.geojson",
      "zoning/Zoning_Overlay.geojson",
      "zoning/Zoning_Overlays.geojson"
    ]),
    resolveDirectorySources("zoning")
  );
}

function resolveWaterInfrastructureSources() {
  return resolveDirectorySources("water");
}

function resolveSewerInfrastructureSources() {
  return resolveDirectorySources("sewer");
}

function resolveAddressPointSources() {
  return mergeUniqueSources(
    resolveExistingSources([
      "address-points/county_web_address_public_-188770469752292398.geojson",
      "address-points/Address_Points_7269351287431368060.geojson",
      "address-points/stratmap25-addresspoints_48.gdb"
    ]),
    resolveDirectorySources("address-points")
  );
}

function resolveCitiesEtjSources() {
  return mergeUniqueSources(
    resolveExistingSources([
      "cities/williamson_cities.geojson",
      "cities/williamson_etj.geojson",
      "cities/hays_city_boundaries.geojson",
      "cities/hays_etj_boundaries.geojson",
      "cities/Hays_County_City_Boundaries.geojson",
      "cities/Hays_County_ETJ.geojson",
      "cities/Municipal_Jurisdictions_Boundaries.geojson",
      "cities/cities_public_-4106374378684537429.geojson",
      "cities/etj_public_8426309624876459445.geojson"
    ]),
    resolveDirectorySources("cities")
  );
}

function resolveOpportunityZoneSources() {
  return mergeUniqueSources(
    resolveExistingSources([
      "opportunity-zones/Opportunity_Zones_2244808886865986276.geojson"
    ]),
    resolveDirectorySources("opportunity-zones")
  );
}

function resolveParcelSources() {
  const parcelRoot = path.join(SOURCE_ROOT, "parcels");
  const stratmapShapefiles = [];
  if (fs.existsSync(parcelRoot) && fs.statSync(parcelRoot).isDirectory()) {
    const countyHints = ["travis", "williamson", "hays"];
    const entries = fs.readdirSync(parcelRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^stratmap25-landparcels_/i.test(entry.name)) {
        continue;
      }

      const shpDir = path.join(parcelRoot, entry.name, "shp");
      if (!fs.existsSync(shpDir) || !fs.statSync(shpDir).isDirectory()) {
        continue;
      }

      const shpEntries = fs.readdirSync(shpDir, { withFileTypes: true });
      for (const shpEntry of shpEntries) {
        if (!shpEntry.isFile() || !/\.shp$/i.test(shpEntry.name)) {
          continue;
        }
        const lowerName = shpEntry.name.toLowerCase();
        if (countyHints.some((countyName) => lowerName.includes(`_${countyName}_`))) {
          stratmapShapefiles.push(path.join(shpDir, shpEntry.name));
        }
      }
    }
  }

  if (stratmapShapefiles.length > 0) {
    return mergeUniqueSources(stratmapShapefiles);
  }

  return mergeUniqueSources(resolveExistingSources([
    "parcels/travis_county_parcels.geojson",
    "parcels/williamson_county_parcels.geojson",
    "parcels/hays_county_parcels.geojson"
  ]));
}

function resolveOilGasLeaseSources() {
  const candidateDirectories = [
    "oil & gas leases",
    "oil-gas-leases",
    "oil-gas",
    "oil_and_gas"
  ];

  const discovered = [];
  for (const directoryName of candidateDirectories) {
    const layerDir = path.join(SOURCE_ROOT, directoryName);
    if (!fs.existsSync(layerDir) || !fs.statSync(layerDir).isDirectory()) {
      continue;
    }

    const entries = fs.readdirSync(layerDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /\.gdb$/i.test(entry.name)) {
        discovered.push(path.join(layerDir, entry.name));
        continue;
      }
      if (entry.isFile() && /\.(geojson|json|gpkg|shp)$/i.test(entry.name)) {
        discovered.push(path.join(layerDir, entry.name));
      }
    }
  }

  return Array.from(new Set(discovered)).sort((a, b) => a.localeCompare(b));
}

function resolveLayerSources(layer) {
  if (typeof layer.resolveSources === "function") {
    return layer.resolveSources();
  }
  return layer.sources ?? [];
}

function deriveSourceDatasetName(sourcePath) {
  const baseName = path.basename(sourcePath);
  return baseName.replace(/\.(geojson|json|gpkg|shp|gdb)$/i, "");
}

const IMPORT_PLAN = [
  {
    key: "floodplain",
    name: "FEMA Floodplain",
    targetTable: "flood_zones",
    stagingTable: "staging_floodplain",
    resolveSources: () => resolveFloodplainSources(),
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
    resolveSources: () => resolveZoningSources(),
    transformSql: (versionId) => `
      WITH prepared AS (
        SELECT
          to_jsonb(staging_zoning) AS props,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_zoning
        WHERE geom IS NOT NULL
      )
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
              NULLIF(props->>'zoning_ztype', ''),
              NULLIF(props->>'zoning_base', ''),
              NULLIF(props->>'zoning_category', ''),
              NULLIF(props->>'zoining_ty', ''),
              NULLIF(props->>'overlay', ''),
              NULLIF(props->>'overlay_ty', ''),
              'UNKNOWN'
            )
          )
        ) AS zoning_code,
        COALESCE(
          NULLIF(props->>'zoning_description', ''),
          NULLIF(props->>'zoning_des', ''),
          NULLIF(props->>'land_use', ''),
          CASE
            WHEN NULLIF(props->>'overlay_ty', '') IS NOT NULL THEN props->>'overlay_ty'
            WHEN NULLIF(props->>'overlay', '') IS NOT NULL THEN CONCAT('Overlay ', props->>'overlay')
            ELSE NULL
          END,
          NULLIF(props->>'zoning_category', ''),
          NULLIF(props->>'zoining_ty', ''),
          NULLIF(props->>'zoning_ztype', ''),
          NULLIF(props->>'zoning_base', ''),
          'Unknown Zoning'
        ) AS zoning_label,
        CASE
          WHEN COALESCE(NULLIF(props->>'zoning_ztype', ''), NULLIF(props->>'zoning_base', '')) IS NOT NULL
            THEN 'City of Austin'
          WHEN COALESCE(
            NULLIF(props->>'zoning_category', ''),
            NULLIF(props->>'zoining_ty', ''),
            NULLIF(props->>'overlay', ''),
            NULLIF(props->>'overlay_ty', '')
          ) IS NOT NULL
            THEN 'City of Pflugerville'
          ELSE 'Austin Metro'
        END AS jurisdiction,
        ${versionId},
        geom
      FROM prepared;
    `
  },
  {
    key: "water-infrastructure",
    name: "Water Infrastructure",
    targetTable: "utility_infrastructure",
    stagingTable: "staging_water",
    resolveSources: () => resolveWaterInfrastructureSources(),
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
    resolveSources: () => resolveSewerInfrastructureSources(),
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
    resolveSources: () => resolveAddressPointSources(),
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
    resolveSources: () => resolveCitiesEtjSources(),
    transformSql: (versionId) => `
      WITH raw AS (
        SELECT
          to_jsonb(staging_cities_etj) AS props,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_cities_etj
        WHERE geom IS NOT NULL
      ),
      prepared AS (
        SELECT
          CASE
            WHEN NULLIF(props->>'etj_name', '') IS NOT NULL THEN 'etj'
            WHEN NULLIF(props->>'etj_type', '') IS NOT NULL THEN 'etj'
            WHEN UPPER(COALESCE(NULLIF(props->>'city_name', ''), NULLIF(props->>'muni_nm', ''))) LIKE '% ETJ%' THEN 'etj'
            WHEN UPPER(COALESCE(NULLIF(props->>'name', ''), NULLIF(props->>'first_label', ''))) LIKE '%ETJ%' THEN 'etj'
            ELSE 'city'
          END AS boundary_type_raw,
          UPPER(
            TRIM(
              COALESCE(
                NULLIF(REPLACE(props->>'etj_name', ' ETJ', ''), ''),
                NULLIF(props->>'city_name', ''),
                NULLIF(props->>'muni_nm', ''),
                NULLIF(REPLACE(props->>'first_label', ' ETJ', ''), ''),
                NULLIF(REPLACE(REGEXP_REPLACE(props->>'name', '^(City|Village) of ', '', 'i'), ' ETJ', ''), ''),
                'Unknown Jurisdiction'
              )
            )
          ) AS jurisdiction_name,
          geom
        FROM raw
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
    resolveSources: () => resolveOpportunityZoneSources(),
    transformSql: (versionId) => `
      WITH prepared AS (
        SELECT
          COALESCE(
            NULLIF(geoid10::text, ''),
            NULLIF(objectid::text, ''),
            md5(ST_AsBinary(geom)::text)
          ) AS zone_id,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_opportunity_zones
        WHERE geom IS NOT NULL
      ),
      deduped AS (
        SELECT
          zone_id,
          geom,
          ROW_NUMBER() OVER (
            PARTITION BY zone_id
            ORDER BY ST_Area(geom::geography) DESC, md5(ST_AsEWKB(geom)::text)
          ) AS rn
        FROM prepared
      )
      INSERT INTO opportunity_zones (
        zone_id,
        layer_version_id,
        geom
      )
      SELECT
        zone_id,
        ${versionId},
        geom
      FROM deduped
      WHERE rn = 1;
    `
  },
  {
    key: "oil-gas-leases",
    name: "Oil & Gas Leases",
    targetTable: "oil_gas_leases",
    stagingTable: "staging_oil_gas_leases",
    optionalSources: true,
    resolveSources: () => resolveOilGasLeaseSources(),
    transformSql: (versionId) => `
      WITH prepared AS (
        SELECT
          to_jsonb(staging_oil_gas_leases) AS props,
          ST_MakeValid(ST_Force2D(geom))::geometry(GEOMETRY, 4326) AS geom
        FROM staging_oil_gas_leases
        WHERE geom IS NOT NULL
      )
      INSERT INTO oil_gas_leases (
        lease_id,
        lease_name,
        operator_name,
        county_name,
        state_code,
        source_dataset,
        layer_version_id,
        geom
      )
      SELECT
        COALESCE(
          NULLIF(props->>'lease_id', ''),
          NULLIF(props->>'leaseid', ''),
          NULLIF(props->>'lease_no', ''),
          NULLIF(props->>'lease_num', ''),
          NULLIF(props->>'contract_no', ''),
          NULLIF(props->>'tract_id', ''),
          NULLIF(props->>'api', ''),
          md5(ST_AsBinary(geom)::text)
        ) AS lease_id,
        COALESCE(
          NULLIF(props->>'lease_name', ''),
          NULLIF(props->>'lease', ''),
          NULLIF(props->>'tract_name', ''),
          NULLIF(props->>'name', ''),
          'Unknown Lease'
        ) AS lease_name,
        COALESCE(
          NULLIF(props->>'operator_name', ''),
          NULLIF(props->>'operator', ''),
          NULLIF(props->>'company', ''),
          NULLIF(props->>'lessee', ''),
          NULLIF(props->>'owner', ''),
          'unknown'
        ) AS operator_name,
        COALESCE(
          NULLIF(props->>'county_name', ''),
          NULLIF(props->>'county', ''),
          NULLIF(props->>'cnty_nm', '')
        ) AS county_name,
        UPPER(
          COALESCE(
            NULLIF(props->>'state_code', ''),
            NULLIF(props->>'state', ''),
            'TX'
          )
        ) AS state_code,
        COALESCE(
          NULLIF(props->>'source_dataset', ''),
          'unknown'
        ) AS source_dataset,
        ${versionId},
        geom
      FROM prepared;
    `
  },
  {
    key: "parcels",
    name: "Austin Metro Parcels",
    targetTable: "parcels",
    stagingTable: "staging_parcels",
    resolveSources: () => resolveParcelSources(),
    transformSql: (versionId) => `
      WITH staged AS (
        SELECT
          to_jsonb(staging_parcels) AS props,
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3))::geometry(MULTIPOLYGON, 4326) AS geom
        FROM staging_parcels
        WHERE geom IS NOT NULL
      ),
      normalized AS (
        SELECT
          COALESCE(
            NULLIF(
              TRIM(
                CONCAT_WS(
                  '-',
                  UPPER(NULLIF(COALESCE(NULLIF(props->>'county', ''), NULLIF(props->>'cnty_nm', '')), '')),
                  NULLIF(COALESCE(NULLIF(props->>'prop_id', ''), NULLIF(props->>'parcel_id', '')), '')
                )
              ),
              ''
            ),
            md5(ST_AsBinary(geom)::text)
          ) AS parcel_key,
          COALESCE(
            NULLIF(props->>'fips', ''),
            CASE UPPER(COALESCE(NULLIF(props->>'county', ''), NULLIF(props->>'cnty_nm', ''), ''))
              WHEN 'TRAVIS' THEN '453'
              WHEN 'WILLIAMSON' THEN '491'
              WHEN 'HAYS' THEN '209'
              ELSE NULL
            END
          ) AS county_fips,
          COALESCE(NULLIF(props->>'county', ''), NULLIF(props->>'cnty_nm', '')) AS county_name,
          CASE
            WHEN NULLIF(
              TRIM(
                CONCAT_WS(
                  ' ',
                  NULLIF(props->>'situs_num', ''),
                  COALESCE(NULLIF(props->>'situs_st_1', ''), NULLIF(props->>'situs_stre', '')),
                  NULLIF(props->>'situs_st_2', '')
                )
              ),
              ''
            ) IS NOT NULL
              THEN NULLIF(
                TRIM(
                  CONCAT_WS(
                    ' ',
                    NULLIF(props->>'situs_num', ''),
                    COALESCE(NULLIF(props->>'situs_st_1', ''), NULLIF(props->>'situs_stre', '')),
                    NULLIF(props->>'situs_st_2', ''),
                    NULLIF(props->>'situs_city', ''),
                    NULLIF(props->>'situs_stat', ''),
                    NULLIF(props->>'situs_zip', '')
                  )
                ),
                ''
              )
            ELSE NULLIF(TRIM(BOTH ', ' FROM COALESCE(props->>'situs_addr', '')), '')
          END AS situs_address,
          NULLIF(props->>'owner_name', '') AS owner_name,
          COALESCE(
            NULLIF(TRIM(props->>'mail_addr'), ''),
            NULLIF(
              TRIM(
                CONCAT_WS(
                  ', ',
                  NULLIF(
                    TRIM(
                      CONCAT_WS(
                        ' ',
                        NULLIF(props->>'mail_line1', ''),
                        NULLIF(props->>'mail_line2', '')
                      )
                    ),
                    ''
                  ),
                  NULLIF(
                    TRIM(
                      CONCAT_WS(
                        ' ',
                        NULLIF(props->>'mail_city', ''),
                        NULLIF(props->>'mail_stat', ''),
                        NULLIF(props->>'mail_zip', '')
                      )
                    ),
                    ''
                  )
                )
              ),
              ''
            )
          ) AS owner_mailing_address,
          NULLIF(props->>'legal_desc', '') AS legal_description,
          CASE
            WHEN COALESCE(NULLIF(REPLACE(props->>'gis_area', ',', ''), ''), '') !~
              '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$'
              THEN NULL
            WHEN UPPER(COALESCE(NULLIF(props->>'gis_area_u', ''), NULLIF(props->>'lgl_area_u', ''), 'ACRES'))
              IN ('SQFT', 'SQUARE_FEET', 'SQUARE FEET', 'FT2')
              THEN (REPLACE(props->>'gis_area', ',', '')::double precision / 43560.0)::numeric(12,4)
            WHEN UPPER(COALESCE(NULLIF(props->>'gis_area_u', ''), NULLIF(props->>'lgl_area_u', ''), 'ACRES'))
              IN ('SQM', 'SQUARE_METERS', 'SQUARE METERS', 'M2')
              THEN (REPLACE(props->>'gis_area', ',', '')::double precision * 0.00024710538146717)::numeric(12,4)
            ELSE (REPLACE(props->>'gis_area', ',', '')::double precision)::numeric(12,4)
          END AS acreage_raw,
          (ST_Area(geom::geography) / 4046.8564224)::numeric(12,4) AS geom_acreage,
          CASE
            WHEN COALESCE(NULLIF(REPLACE(props->>'land_value', ',', ''), ''), '') ~
              '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$'
              THEN (REPLACE(props->>'land_value', ',', '')::double precision)::numeric(14,2)
            ELSE NULL
          END AS land_value,
          CASE
            WHEN COALESCE(NULLIF(REPLACE(props->>'imp_value', ',', ''), ''), '') ~
              '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$'
              THEN (REPLACE(props->>'imp_value', ',', '')::double precision)::numeric(14,2)
            ELSE NULL
          END AS improvement_value,
          CASE
            WHEN COALESCE(NULLIF(REPLACE(props->>'mkt_value', ',', ''), ''), '') ~
              '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$'
              THEN (REPLACE(props->>'mkt_value', ',', '')::double precision)::numeric(14,2)
            ELSE NULL
          END AS market_value,
          geom
        FROM staged
      ),
      resolved AS (
        SELECT
          parcel_key,
          county_fips,
          county_name,
          situs_address,
          owner_name,
          owner_mailing_address,
          legal_description,
          COALESCE(
            CASE
              WHEN acreage_raw IS NULL THEN NULL
              WHEN UPPER(COALESCE(county_name, '')) = 'TRAVIS'
                THEN (acreage_raw / 10.7639104167)::numeric(12,4)
              ELSE acreage_raw
            END,
            geom_acreage
          ) AS acreage,
          land_value,
          improvement_value,
          market_value,
          geom
        FROM normalized
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY parcel_key
            ORDER BY market_value DESC NULLS LAST, acreage DESC NULLS LAST
          ) AS rn
        FROM resolved
      )
      INSERT INTO parcels (
        parcel_key,
        county_fips,
        county_name,
        situs_address,
        owner_name,
        owner_mailing_address,
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
        owner_mailing_address,
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
        owner_mailing_address = EXCLUDED.owner_mailing_address,
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
    "--config",
    "PG_USE_COPY",
    "YES",
    "-f",
    "PostgreSQL",
    pgConnectionString,
    source,
    "-gt",
    "65536",
    "-nln",
    stagingTable,
    overwrite ? "-overwrite" : "-append",
    "-addfields",
    "-fieldTypeToString",
    "All",
    // Use large transactions for speed; skipfailures is intentionally disabled
    // because GDAL does not allow combining it with -gt.
    // Geometry is normalized in the SQL transform phase (ST_MakeValid), so skip pre-normalization for speed.
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
  const explicitLayerSelection = new Set(args.layers ?? []);

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
      const layerSources = resolveLayerSources(layer);
      const selectedExplicitly = explicitLayerSelection.has(layer.key);
      if (layerSources.length === 0) {
        if (layer.optionalSources && !selectedExplicitly) {
          console.warn(`[skip] ${layer.key}: no source files found under data/raw/oil & gas leases`);
          continue;
        }
        throw new Error(`No source files resolved for layer: ${layer.key}`);
      }

      for (const source of layerSources) {
        ensureFileExists(source);
      }

      console.log(`\n=== Importing layer: ${layer.key} ===`);

      const createVersionAndClearOldData = async () => {
        const previousVersionsResult = await client.query(
          `
            SELECT id::bigint AS id
            FROM data_layer_versions
            WHERE layer_key = $1
          `,
          [layer.key]
        );
        const previousVersionIds = previousVersionsResult.rows.map((row) => Number(row.id));

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
              sourceCount: layerSources.length,
              bbox: args.bbox
            })
          ]
        );
        const nextVersionId = Number(versionResult.rows[0].id);

        if (previousVersionIds.length > 0) {
          if (layer.key === "parcels") {
            // Parcel refresh is very large; truncate reuses table storage immediately
            // and avoids running out of disk during full reloads.
            await client.query(`TRUNCATE TABLE ${layer.targetTable}`);
          } else {
            await client.query(`DELETE FROM ${layer.targetTable} WHERE layer_version_id = ANY($1::bigint[])`, [previousVersionIds]);
          }
          await client.query("DELETE FROM data_layer_versions WHERE id = ANY($1::bigint[])", [previousVersionIds]);
        }

        return nextVersionId;
      };

      let versionId = null;

      if (layer.key === "parcels" && layerSources.length > 1) {
        await client.query("BEGIN");
        try {
          versionId = await createVersionAndClearOldData();
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }

        for (const [sourceIndex, source] of layerSources.entries()) {
          console.log(
            `Processing parcel source ${sourceIndex + 1}/${layerSources.length}: ${path.basename(source)}`
          );

          await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
          const ogrArgs = buildOgrArgs({
            pgConnectionString,
            source,
            stagingTable: layer.stagingTable,
            overwrite: true,
            bbox: args.bbox
          });
          runCommand("ogr2ogr", ogrArgs);

          await client.query("BEGIN");
          try {
            await client.query(layer.transformSql(versionId));
            await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
            throw error;
          }
        }
      } else {
        await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);

        let first = true;
        for (const source of layerSources) {
          const ogrArgs = buildOgrArgs({
            pgConnectionString,
            source,
            stagingTable: layer.stagingTable,
            overwrite: first,
            bbox: args.bbox
          });
          runCommand("ogr2ogr", ogrArgs);

          if (layer.key === "oil-gas-leases") {
            await client.query(`ALTER TABLE ${layer.stagingTable} ADD COLUMN IF NOT EXISTS source_dataset TEXT`);
            await client.query(
              `UPDATE ${layer.stagingTable}
               SET source_dataset = $1
               WHERE source_dataset IS NULL`,
              [deriveSourceDatasetName(source)]
            );
          }

          first = false;
        }

        await client.query("BEGIN");
        try {
          versionId = await createVersionAndClearOldData();
          await client.query(layer.transformSql(versionId));
          await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          await client.query(`DROP TABLE IF EXISTS ${layer.stagingTable}`);
          throw error;
        }
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
