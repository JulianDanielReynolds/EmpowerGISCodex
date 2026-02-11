# Data Pipeline

ETL jobs for ingesting public datasets, normalizing schemas, generating vector tiles, and publishing artifacts.

## Included in this phase

- `config/layers.austin.json` source manifest for Austin startup layers
- `scripts/validate-layer-sources.mjs` checks referenced files exist
- `scripts/build-tiles.mjs` placeholder tile artifact builder
- `scripts/import-austin-postgis.mjs` loads real Austin layers into PostGIS canonical tables

## Next implementation target

Replace placeholder tile builder with streamed MVT generation and cloud artifact upload.

## Source data location

- Default expected root: `data/raw` inside this repository.
- Override with `DATA_SOURCE_ROOT=/absolute/path/to/data/raw` when your raw data is stored elsewhere.
- If neither is present, scripts fall back to the legacy local path used in earlier builds.
- Oil and gas layer source files should be placed under `data/raw/oil & gas leases/` (or `data/raw/oil-gas-leases/`) as GeoJSON, Shapefile, GeoPackage, or FileGDB.

## Import commands

1. Non-parcel startup layers:
   - `npm run import:austin -w @empowergis/data-pipeline -- --skip-parcels`
2. Parcel import only (can be heavy):
   - `npm run import:austin -w @empowergis/data-pipeline -- --layers=parcels`
3. Bounded parcel import:
   - `npm run import:austin -w @empowergis/data-pipeline -- --layers=parcels --bbox=-97.95,30.05,-97.55,30.55`
4. Oil & gas leases only:
   - `npm run import:austin -w @empowergis/data-pipeline -- --layers=oil-gas-leases`
