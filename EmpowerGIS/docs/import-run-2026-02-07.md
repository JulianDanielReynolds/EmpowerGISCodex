# Austin Import Run (2026-02-07)

## Commands executed

1. Non-parcel layers:
   - `npm run import:austin -w @empowergis/data-pipeline -- --skip-parcels --bbox=-98.3,29.7,-97.0,31.0`
2. Bounded parcels:
   - `npm run import:austin -w @empowergis/data-pipeline -- --layers=parcels --bbox=-97.95,30.05,-97.55,30.55`

## Final row counts

- `parcels`: `433088`
- `flood_zones`: `9099`
- `contour_lines`: `33809`
- `zoning_districts`: `22490`
- `utility_infrastructure`: `70746`
- `municipal_boundaries`: `67`
- `opportunity_zones`: `39`

## Endpoint checks passed

1. `GET /api/health`
2. `GET /api/ready`
3. `POST /api/auth/register`
4. `POST /api/auth/login`
5. `GET /api/auth/me`
6. `GET /api/layers` (all startup layers reported `ready`)
7. `GET /api/properties/search?q=Congress`
8. `GET /api/properties/by-coordinates` (using search-returned coordinates)
9. `GET /tiles` and sample tile fetch under `/tiles/:layer/:z/:x/:y.pbf`

## Known caveat

The parcel import above is bounded to central Austin region (`--bbox=-97.95,30.05,-97.55,30.55`) for faster iteration. Run full parcel import without bbox for complete metro coverage.
