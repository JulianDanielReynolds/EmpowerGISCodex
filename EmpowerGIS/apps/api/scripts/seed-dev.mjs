import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for seed script");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

const layers = [
  ["floodplain", "FEMA Floodplain"],
  ["contours", "Contour Lines"],
  ["zoning", "Zoning"],
  ["water-infrastructure", "Water Infrastructure"],
  ["sewer-infrastructure", "Sewer Infrastructure"],
  ["cities-etj", "Cities / ETJ"],
  ["opportunity-zones", "Opportunity Zones"]
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [key, name] of layers) {
      await client.query(
        `
          INSERT INTO data_layer_versions (
            layer_key,
            layer_name,
            source_name,
            source_url,
            source_snapshot_date,
            metadata
          )
          VALUES ($1, $2, $3, $4, CURRENT_DATE, $5::jsonb)
        `,
        [
          key,
          name,
          "Dev seed",
          "https://www.empowergis.com/dev-seed",
          JSON.stringify({ seededBy: "seed-dev.mjs" })
        ]
      );
    }

    await client.query(
      `
        INSERT INTO zoning_districts (
          zoning_code,
          zoning_label,
          jurisdiction,
          geom
        )
        VALUES (
          'SF-3',
          'Family Residence',
          'City of Austin',
          ST_GeomFromText(
            'MULTIPOLYGON(((-97.7490 30.2660,-97.7420 30.2660,-97.7420 30.2720,-97.7490 30.2720,-97.7490 30.2660)))',
            4326
          )
        )
      `
    );

    await client.query(
      `
        INSERT INTO parcels (
          parcel_key,
          county_fips,
          county_name,
          situs_address,
          owner_name,
          owner_mailing_address,
          legal_description,
          acreage,
          land_value,
          improvement_value,
          market_value,
          zoning_code,
          geom
        )
        VALUES (
          'DEV-PARCEL-0001',
          '453',
          'Travis',
          '110 Congress Ave, Austin, TX',
          'EmpowerGIS Test Owner',
          'PO BOX 1000, Austin, TX 78701',
          'Lot 1 Block A EmpowerGIS Demo Subdivision',
          0.82,
          650000,
          1250000,
          1900000,
          'SF-3',
          ST_GeomFromText(
            'MULTIPOLYGON(((-97.7465 30.2670,-97.7455 30.2670,-97.7455 30.2682,-97.7465 30.2682,-97.7465 30.2670)))',
            4326
          )
        )
        ON CONFLICT (parcel_key) DO NOTHING
      `
    );

    await client.query("COMMIT");
    console.log("Seed data inserted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
