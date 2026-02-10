UPDATE address_points
SET normalized_address = LOWER(REGEXP_REPLACE(COALESCE(address_label, ''), '[^A-Za-z0-9]+', ' ', 'g'))
WHERE normalized_address IS DISTINCT FROM LOWER(REGEXP_REPLACE(COALESCE(address_label, ''), '[^A-Za-z0-9]+', ' ', 'g'));

DROP INDEX IF EXISTS idx_address_points_normalized_trgm;
CREATE INDEX IF NOT EXISTS idx_address_points_normalized_trgm
ON address_points USING GIN (normalized_address gin_trgm_ops);

DROP INDEX IF EXISTS idx_parcels_normalized_address_trgm;
CREATE INDEX IF NOT EXISTS idx_parcels_normalized_address_trgm
ON parcels USING GIN ((LOWER(REGEXP_REPLACE(COALESCE(situs_address, ''), '[^A-Za-z0-9]+', ' ', 'g'))) gin_trgm_ops);

DROP INDEX IF EXISTS idx_parcels_normalized_owner_trgm;
CREATE INDEX IF NOT EXISTS idx_parcels_normalized_owner_trgm
ON parcels USING GIN ((LOWER(REGEXP_REPLACE(COALESCE(owner_name, ''), '[^A-Za-z0-9]+', ' ', 'g'))) gin_trgm_ops);

