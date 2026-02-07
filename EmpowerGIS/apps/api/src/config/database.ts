import { Pool } from "pg";
import { env } from "./env.js";

const shouldUseSsl = env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export async function checkDatabaseReadiness(): Promise<boolean> {
  const result = await pool.query("SELECT 1 as ok");
  return result.rows[0]?.ok === 1;
}
