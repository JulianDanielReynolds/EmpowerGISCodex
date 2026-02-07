import { pool } from "../config/database.js";

export async function logUserActivity(
  eventType: string,
  metadata: Record<string, unknown>,
  userId?: number
): Promise<void> {
  try {
    await pool.query(
      `
        INSERT INTO user_activity_logs (user_id, event_type, metadata)
        VALUES ($1, $2, $3::jsonb)
      `,
      [userId ?? null, eventType, JSON.stringify(metadata)]
    );
  } catch (error) {
    // Activity logging should never block request flow.
    console.error("Failed to log user activity", error);
  }
}
