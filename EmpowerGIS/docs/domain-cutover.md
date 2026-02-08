# Domain Cutover Plan (`empowergis.com`)

Date prepared: 2026-02-07

## Target domains

- Web app: `https://www.empowergis.com` and `https://empowergis.com`
- API: `https://api.empowergis.com`
- Tile CDN: `https://tiles.empowergis.com`

## Hosting split

1. Vercel project for web (`@empowergis/web`)
2. Railway service for API (`@empowergis/api`)
3. Tile host (`tiles.empowergis.com`) pointed to API tile routes with CDN/proxy caching enabled

## Required environment variables

## Web (`apps/web/.env`)

- `VITE_API_BASE_URL=https://api.empowergis.com/api`
- `VITE_MAPBOX_ACCESS_TOKEN=<mapbox-public-token>`

## API (`apps/api/.env`)

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

## DNS (GoDaddy)

1. Point root domain to Vercel:
   - `A @ 76.76.21.21`
2. Point `www` to Vercel:
   - `CNAME www cname.vercel-dns.com`
3. Point API hostname:
   - `CNAME api <railway-service-hostname>`
4. Point tiles hostname:
   - `CNAME tiles <cdn-hostname>`

## SSL

- Vercel provisions certs for root + `www`.
- Railway provisions cert for API hostname once DNS resolves.
- CDN provisions cert for tile hostname.

## Cutover checks

1. `https://api.empowergis.com/api/health` returns `status: ok`.
2. `https://api.empowergis.com/api/ready` returns `status: ready`.
3. Web app loads at `https://www.empowergis.com`.
4. Registration/login works and second login invalidates first session.
5. Property search and click lookups return parcel data.
6. Layer catalog API returns all required startup layers.
7. Tile metadata loads:
   - `https://tiles.empowergis.com/tiles/zoning/metadata.json`
8. Sample tile fetch succeeds:
   - `https://tiles.empowergis.com/tiles/zoning/10/301/385.pbf`
