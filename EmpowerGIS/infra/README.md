# Infrastructure

Deployment and infrastructure-as-code assets for web, API, database, storage, and observability.

## Local bootstrap

Use `/Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml` to run:

- Postgres + PostGIS
- Redis

Start:

- `docker compose -f /Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml up -d`

Stop:

- `docker compose -f /Users/julianreynolds/Documents/New project/EmpowerGIS/infra/docker-compose.yml down`
