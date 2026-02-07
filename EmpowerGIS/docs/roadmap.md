# EmpowerGIS Rebuild Roadmap

## Objectives

1. Launch stable Austin metro production at `https://www.empowergis.com/`.
2. Enforce single active session per username.
3. Capture user activity and account metadata for operations and product decisions.
4. Build architecture that scales city-by-city to nationwide coverage.

## Target architecture (Austin MVP, scale-ready)

1. Frontend (`Vercel`): React/Next.js map app, disclaimer + auth + dashboard.
2. API (`Railway` or managed container platform): Node.js service with PostgreSQL/PostGIS.
3. Data pipeline (scheduled jobs): ETL + tile generation + validation.
4. Storage:
   - PostGIS for parcel and lookup data
   - Object storage + CDN for vector tiles (not local server disk)
5. Observability: centralized logs, metrics, error tracking, uptime checks.

## Domain strategy for `empowergis.com`

1. Keep web app on:
   - `https://empowergis.com`
   - `https://www.empowergis.com`
2. Put API on subdomain:
   - `https://api.empowergis.com`
3. Put tile CDN on subdomain:
   - `https://tiles.empowergis.com`
4. Configure CORS only for production web origins and local dev origin.

## Authentication/session plan (single active session)

1. Use short-lived access tokens + rotating refresh tokens.
2. Store refresh sessions in DB table with:
   - `user_id`, `session_id`, `device_fingerprint`, `ip`, `created_at`, `revoked_at`
3. On login:
   - revoke any active session for that user
   - create one new active session
4. On every authenticated request:
   - verify token + active session record
5. On second login elsewhere:
   - first session is invalidated immediately.

## Data model and GIS runtime plan

1. Replace in-memory GeoJSON property lookup with PostGIS spatial query:
   - `ST_Contains` against indexed parcel geometry.
2. Normalize parcels and tax attributes into separate linked tables.
3. Keep each public layer versioned with source/date metadata.
4. Generate vector tiles offline and publish to object storage.

## Phased delivery

## Phase 0 (Week 1): Foundation

1. Create monorepo structure and CI pipeline.
2. Set environment model (dev/staging/prod).
3. Define baseline schema and migration workflow.
4. Add observability baseline.

## Phase 1 (Weeks 2-3): Auth + Core Shell

1. Build disclaimer gate, login/register, password reset.
2. Implement single-session enforcement.
3. Implement user activity logging endpoints.
4. Ship map shell with Austin extent and base map switch.

## Phase 2 (Weeks 3-5): Austin Data MVP

1. Import Austin parcels and core tax attributes into PostGIS.
2. Stand up property click and search APIs.
3. Publish first layer set:
   - FEMA floodplain
   - contours
   - zoning
   - water infrastructure
   - sewer infrastructure
   - cities/ETJ
   - opportunity zones
4. Build layer toggle UI and parcel detail panel.

## Phase 3 (Weeks 5-6): Production hardening

1. Add rate limits, request tracing, and cache strategy.
2. Add test coverage for auth, spatial lookups, and layer APIs.
3. Add backup/restore and incident runbooks.
4. Configure DNS and cutover for `www.empowergis.com`.

## Phase 4 (Weeks 7-8): Scale envelope

1. Introduce region-aware schema partitioning (county/state keys).
2. Add data ingestion templates for new metros.
3. Add job orchestration for refresh schedules and quality checks.
4. Add billing/subscription hooks if needed for paid rollout.

## What to migrate first from old project

1. `config/layers.config.json` as initial layer/source catalog reference.
2. `scripts/lib/*` tile generation concepts into dedicated pipeline package.
3. UI behavior patterns from:
   - `frontend/src/components/Auth/*`
   - `frontend/src/components/Map/LayerManager.ts`
   - `frontend/src/components/PropertyInfo/PropertyPanel.tsx`
4. Do **not** migrate runtime file-based API logic from `backend/src/routes/properties.ts` and `backend/src/routes/tiles.ts`.

## Definition of done for Austin launch

1. 99.9% API uptime target over 30 days.
2. P95 parcel lookup under 500ms in production.
3. One-user-one-session enforced and tested.
4. Full Austin layer stack available with metadata and refresh history.
5. Production runbook and rollback plan documented.
