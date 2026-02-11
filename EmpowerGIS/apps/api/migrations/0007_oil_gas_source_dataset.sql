ALTER TABLE oil_gas_leases
ADD COLUMN IF NOT EXISTS source_dataset TEXT;

UPDATE oil_gas_leases
SET source_dataset = COALESCE(source_dataset, 'unknown')
WHERE source_dataset IS NULL;

ALTER TABLE oil_gas_leases
ALTER COLUMN source_dataset SET DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_oil_gas_leases_source_dataset
ON oil_gas_leases (source_dataset);

