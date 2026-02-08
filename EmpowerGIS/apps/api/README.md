# API Service

Backend APIs for:

- authentication and single-session enforcement
- GIS property and layer endpoints
- telemetry/event logging

## Current implementation

- `src/routes/health.ts` - health and readiness endpoints
- `src/routes/auth.ts` - register/login/logout/refresh/me
- `src/routes/properties.ts` - coordinate lookup, search, and parcel stats
- `src/routes/layers.ts` - layer catalog and tile templates
- `src/routes/tiles.ts` - live PostGIS vector tile endpoint (`/tiles/:layer/:z/:x/:y.pbf`)
- `src/middleware/auth.ts` - token/session verification middleware
- `migrations/` - baseline PostGIS + auth + GIS schema

## Run locally

1. Copy env file:
   - `cp /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/.env.example /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/.env`
2. Start database via `/Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml`
3. Run migrations:
   - `npm run migrate -w @empowergis/api`
4. Start API:
   - `npm run dev -w @empowergis/api`
5. Optional dev seed:
   - `npm run seed:dev -w @empowergis/api`

## End-to-end tests

Run from repository root:

- `npm run test:e2e:api`

This runs a real API process against your configured Postgres connection and validates auth/session and GIS endpoints.
