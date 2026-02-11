CREATE TABLE IF NOT EXISTS oil_gas_leases (
  id BIGSERIAL PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_name TEXT,
  operator_name TEXT,
  county_name TEXT,
  state_code TEXT,
  layer_version_id BIGINT REFERENCES data_layer_versions(id) ON DELETE SET NULL,
  geom GEOMETRY(GEOMETRY, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oil_gas_leases_geom
ON oil_gas_leases USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_oil_gas_leases_lease_id
ON oil_gas_leases (lease_id);

