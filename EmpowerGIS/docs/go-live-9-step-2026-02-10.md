# EmpowerGIS Go-Live 9-Step Runbook (2026-02-10)

This runbook publishes from the stable checkpoint:

- Commit: `fec7466`
- Tag: `empowergis-checkpoint-2026-02-10-predeploy`
- Bundle backup: `/Users/julianreynolds/Documents/New project/empowergis-checkpoint-2026-02-10.bundle`

## 1. Lock the release marker

Already complete.

Validation:

```bash
cd "/Users/julianreynolds/Documents/New project"
git show --no-patch --decorate --oneline empowergis-checkpoint-2026-02-10-predeploy
```

## 2. Push source and tag to remote backup

Create an empty GitHub repo (no README), then:

```bash
cd "/Users/julianreynolds/Documents/New project"
git remote add origin <github-repo-url>
git push -u origin main
git push origin empowergis-checkpoint-2026-02-10-predeploy
```

## 3. Prepare production environment variables

Web (`@empowergis/web`):

- `VITE_API_BASE_URL=https://api.empowergis.com/api`
- `VITE_MAPBOX_ACCESS_TOKEN=<public-mapbox-token>`

API (`@empowergis/api`):

- `NODE_ENV=production`
- `PORT=4000`
- `DATABASE_URL=<managed-postgres-url>`
- `JWT_ACCESS_SECRET=<long-random-secret>`
- `JWT_ACCESS_TTL_MINUTES=15`
- `REFRESH_TOKEN_TTL_DAYS=14`
- `BCRYPT_ROUNDS=12`
- `CORS_ORIGINS=https://www.empowergis.com,https://empowergis.com`
- `TILE_BASE_URL=https://tiles.empowergis.com/tiles`
- `TILE_MAX_FEATURES=10000`

## 4. Provision production Postgres

Use Railway PostgreSQL (or your chosen managed DB) and copy the connection URL.

## 5. Run migrations and data import against production DB

From local machine:

```bash
cd "/Users/julianreynolds/Documents/New project/EmpowerGIS"
export DATABASE_URL="<managed-postgres-url>"
npm run db:migrate
npm run import:austin -w @empowergis/data-pipeline -- --skip-parcels --bbox=-98.3,29.7,-97.0,31.0
npm run import:austin -w @empowergis/data-pipeline -- --layers=parcels
```

Notes:

- The full parcel import may take significant time.
- Current address-point source is `data/raw/address-points/stratmap25-addresspoints_48.gdb`.

## 6. Deploy API to Railway

- Root directory: repo root
- Service: `@empowergis/api`
- Start command (already in `apps/api/railway.json`):
  - `npm run build -w @empowergis/api && npm run start -w @empowergis/api`
- Set API env vars from Step 3.
- Confirm:
  - `https://api.empowergis.com/api/health`
  - `https://api.empowergis.com/api/ready`

## 7. Deploy web to Vercel

- Project root: repo root
- Build config from `apps/web/vercel.json`
- Set web env vars from Step 3.
- Confirm web preview loads before DNS cutover.

## 8. DNS cutover (GoDaddy)

Set records:

- `A @ 76.76.21.21`
- `CNAME www cname.vercel-dns.com`
- `CNAME api <railway-service-hostname>`
- `CNAME tiles <cdn-hostname or api host if reusing API tiles>`

Wait for SSL provisioning on all hosts.

## 9. Post-cutover smoke test and rollback gate

Smoke test:

1. Open `https://www.empowergis.com`
2. Register/login
3. Search by address and confirm autocomplete appears
4. Click parcel and confirm parcel data panel values
5. Toggle all layers and verify tile rendering
6. Confirm API endpoints still healthy

If critical failure occurs:

```bash
cd "/Users/julianreynolds/Documents/New project"
git switch -c rollback-from-checkpoint empowergis-checkpoint-2026-02-10-predeploy
```

Then redeploy from that rollback branch/tag in Vercel and Railway.
