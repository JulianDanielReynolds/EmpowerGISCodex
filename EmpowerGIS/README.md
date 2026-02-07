# EmpowerGIS (Fresh Rebuild)

This folder is the clean start for the new EmpowerGIS platform focused on:

- Austin metro MVP first
- production-grade reliability
- nationwide scalability from day one

## Initial workspace layout

- `apps/web` - map UI, auth flow, disclaimer, search, parcel detail panel
- `apps/api` - auth, property lookup, layers metadata, telemetry APIs
- `data-pipeline` - ETL and tile generation jobs
- `infra` - deployment and infrastructure configs
- `packages/shared` - shared types, validation schemas, utility libraries
- `docs/legacy-review.md` - what to reuse from old project
- `docs/roadmap.md` - phased rebuild plan
- `docs/domain-cutover.md` - deployment and DNS cutover plan
- `docs/phase1-progress.md` - implementation progress notes

## Starting principle

Data preparation is offline/batch. Runtime services read from managed databases/object storage, not local filesystem paths.

## Phase 0 status

The repository now includes:

- monorepo workspace config at `/Users/julianreynolds/Documents/New project/EmpowerGIS/package.json`
- API scaffolding with migrations in `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api`
- web shell scaffolding in `/Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web`
- shared package in `/Users/julianreynolds/Documents/New project/EmpowerGIS/packages/shared`
- local infra bootstrap in `/Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml`

## Local startup (after dependency install)

1. `cd /Users/julianreynolds/Documents/New project/EmpowerGIS`
2. `npm install`
3. `cp /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/.env.example /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/api/.env`
4. `cp /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/.env.example /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/.env`
5. `docker compose -f /Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml up -d`
6. `npm run db:migrate`
7. `npm run db:seed:dev` (optional local demo data)
8. `npm run dev:api`
9. `npm run dev:web`

## Austin data import (real public data)

From `/Users/julianreynolds/Documents/New project/EmpowerGIS`:

1. `npm run import:austin -w @empowergis/data-pipeline -- --skip-parcels`
2. `npm run import:austin -w @empowergis/data-pipeline -- --layers=parcels --bbox=-97.95,30.05,-97.55,30.55` (optional bounded parcel import)
