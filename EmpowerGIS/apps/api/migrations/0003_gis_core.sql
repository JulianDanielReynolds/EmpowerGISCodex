CREATE TABLE IF NOT EXISTS data_layer_versions (
  id BIGSERIAL PRIMARY KEY,
  layer_key TEXT NOT NULL,
  layer_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_snapshot_date DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_data_layer_versions_layer_key
ON data_layer_versions (layer_key, imported_at DESC);

CREATE TABLE IF NOT EXISTS parcels (
  id BIGSERIAL PRIMARY KEY,
  parcel_key TEXT NOT NULL UNIQUE,
  county_fips TEXT,
  county_name TEXT,
  situs_address TEXT,
  owner_name TEXT,
  owner_mailing_address TEXT,
  legal_description TEXT,
  acreage NUMERIC(12, 4),
  land_value NUMERIC(14, 2),
  improvement_value NUMERIC(14, 2),
  market_value NUMERIC(14, 2),
  zoning_code TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parcels_county_fips
ON parcels (county_fips);

CREATE INDEX IF NOT EXISTS idx_parcels_address
ON parcels (situs_address);

CREATE INDEX IF NOT EXISTS idx_parcels_owner
ON parcels (owner_name);

CREATE INDEX IF NOT EXISTS idx_parcels_geom
ON parcels USING GIST (geom);

CREATE TABLE IF NOT EXISTS zoning_districts (
  id BIGSERIAL PRIMARY KEY,
  zoning_code TEXT,
  zoning_label TEXT,
  jurisdiction TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zoning_geom
ON zoning_districts USING GIST (geom);

CREATE TABLE IF NOT EXISTS flood_zones (
  id BIGSERIAL PRIMARY KEY,
  flood_zone_code TEXT,
  flood_zone_label TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flood_zones_geom
ON flood_zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS contour_lines (
  id BIGSERIAL PRIMARY KEY,
  elevation_ft NUMERIC(10, 2),
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTILINESTRING, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contour_lines_geom
ON contour_lines USING GIST (geom);

CREATE TABLE IF NOT EXISTS utility_infrastructure (
  id BIGSERIAL PRIMARY KEY,
  utility_type TEXT NOT NULL,
  utility_subtype TEXT,
  operator_name TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(GEOMETRY, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_utility_type
ON utility_infrastructure (utility_type);

CREATE INDEX IF NOT EXISTS idx_utility_geom
ON utility_infrastructure USING GIST (geom);

CREATE TABLE IF NOT EXISTS municipal_boundaries (
  id BIGSERIAL PRIMARY KEY,
  boundary_type TEXT NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_municipal_boundaries_geom
ON municipal_boundaries USING GIST (geom);

CREATE TABLE IF NOT EXISTS opportunity_zones (
  id BIGSERIAL PRIMARY KEY,
  zone_id TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opportunity_zones_geom
ON opportunity_zones USING GIST (geom);
