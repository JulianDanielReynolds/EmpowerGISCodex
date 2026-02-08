# Phase 1 Progress

Date: 2026-02-07 (updated 2026-02-08)

## Implemented in this pass

1. Authenticated GIS API routes:
   - `GET /api/properties/by-coordinates`
   - `GET /api/properties/search`
   - `GET /api/properties/bounds`
   - `GET /api/properties/stats`
   - `GET /api/layers`
2. Activity logging service reused across auth and GIS requests.
3. Web map integration with:
   - Mapbox basemap
   - layer toggle wiring from API catalog
   - search-to-fly and click-to-parcel lookup
   - live parcel detail panel
4. Registration path added in auth modal.
5. Deployment templates and domain cutover checklist.
6. Dev seed script for local demo data:
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/scripts/seed-dev.mjs`
7. Real Austin PostGIS import pipeline:
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/data-pipeline/scripts/import-austin-postgis.mjs`
8. Local tile serving route for development:
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/src/routes/tiles.ts`
9. Web refresh-token rotation and request retry on `401`:
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/src/lib/api.ts`
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/src/App.tsx`
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/src/components/MapShell.tsx`
10. End-to-end auth and GIS API test flow:
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/tests/e2e/auth-gis.e2e.mjs`
11. Live tile service path from PostGIS (ready for `tiles.empowergis.com/tiles`):
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/src/routes/tiles.ts`
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/src/routes/layers.ts`
   - `/Users/julianreynolds/Documents/New project/EmpowerGIS/docs/domain-cutover.md`

## Remaining for Phase 1 completion

1. None.
