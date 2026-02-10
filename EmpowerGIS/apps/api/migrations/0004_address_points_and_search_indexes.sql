CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS address_points (
  id BIGSERIAL PRIMARY KEY,
  address_label TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  city_name TEXT,
  county_name TEXT,
  postal_code TEXT,
  source_name TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(POINT, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_address_points_geom
ON address_points USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_address_points_county_name
ON address_points (county_name);

CREATE INDEX IF NOT EXISTS idx_address_points_normalized_trgm
ON address_points USING GIN (normalized_address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_parcels_normalized_address_trgm
ON parcels USING GIN ((LOWER(REGEXP_REPLACE(COALESCE(situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g'))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_parcels_normalized_owner_trgm
ON parcels USING GIN ((LOWER(REGEXP_REPLACE(COALESCE(owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g'))) gin_trgm_ops);
