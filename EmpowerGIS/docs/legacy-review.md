# Legacy Review: `/Users/julianreynolds/austin-gis-platform`

## Scope reviewed

- Backend API and auth routes
- Frontend map/auth components
- Deployment config (Railway/Vercel docs + config files)
- Data organization and tile generation scripts
- Migrations and environment setup

## What to reuse

1. Data inventory and source coverage in `/Users/julianreynolds/austin-gis-platform/data/raw`.
2. Layer catalog and source mapping in `/Users/julianreynolds/austin-gis-platform/config/layers.config.json`.
3. Tile generation pipeline code in:
   - `/Users/julianreynolds/austin-gis-platform/scripts/build-tiles.js`
   - `/Users/julianreynolds/austin-gis-platform/scripts/build-parcels.js`
   - `/Users/julianreynolds/austin-gis-platform/scripts/lib/tile-generator.js`
4. Frontend feature ideas/components to port, not copy as-is:
   - disclaimer-first entry UX
   - login/register flow
   - layer manager pattern
   - measurement tools and property details panel

## What to retire

1. Runtime property lookup from raw GeoJSON files in memory:
   - `/Users/julianreynolds/austin-gis-platform/backend/src/routes/properties.ts`
2. Runtime tile serving from local disk:
   - `/Users/julianreynolds/austin-gis-platform/backend/src/routes/tiles.ts`
3. Relative path assumptions to `../../../data/...` in backend code.
4. Mixed/stale backend artifacts and route drift (`dist` has files not present in `src`).
5. Deployment docs that reference missing migrations (001/002 are referenced but not present).

## Likely go-live failure causes

1. **Backend filesystem path break in Railway root deployment**
   - Backend routes resolve to local paths like `../../../data/tiles` and `../../../data/raw/parcels`.
   - If Railway root is `backend`, compiled path resolves to `/data/...`, not project data.
   - Verified behavior:
     - From `/app/dist/routes`, `path.resolve('../../../data/tiles')` => `/data/tiles`.
2. **Data not present in deployed artifact**
   - `data/raw/*` is excluded by `.gitignore`, so runtime file-based endpoints cannot work in production.
3. **Architecture mismatch**
   - Project intended PostGIS usage, but active property endpoint still uses in-memory GeoJSON point-in-polygon logic.
4. **Migration/document drift**
   - Deployment docs reference SQL migrations that do not exist in repo.

## Additional scale risks in legacy approach

1. Full parcel feature loading into memory for search/click lookups.
2. No nationwide partitioning strategy for parcels/layers.
3. No single-session enforcement per username.
4. No structured event telemetry/audit pipeline for user activity.

## Data/storage observations

1. Local data footprint is very large (`~34G` under `data/`).
2. Largest raw segment is `/Users/julianreynolds/austin-gis-platform/data/raw/austin-city` (`~22G`).
3. This validates need for object storage + batch ETL jobs, not repository/runtime bundling.

## Salvage decision summary

- Keep: source data, layer definitions, tile-generation concepts, UX patterns.
- Rebuild: API runtime, auth/session model, deployment topology, database schema, observability, and CI/CD.
