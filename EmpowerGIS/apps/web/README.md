# Web App

Frontend shell with:

- disclaimer gate before access
- login integration with API auth routes
- map workspace layout and layer panel placeholders

## Run locally

1. Copy env file:
   - `cp /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/.env.example /Users/julianreynolds/Documents/New project/EmpowerGIS/apps/web/.env`
2. Start web:
   - `npm run dev -w @empowergis/web`

Set `VITE_MAPBOX_ACCESS_TOKEN` in the env file to enable the interactive basemap.
