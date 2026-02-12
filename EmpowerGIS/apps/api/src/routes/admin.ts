import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import { asyncHandler } from "../lib/http.js";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { logUserActivity } from "../services/activity.js";

const adminRouter = Router();

const usersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  search: z.string().trim().max(120).optional()
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  userId: z.coerce.number().int().positive().optional(),
  eventType: z.string().trim().min(1).max(100).optional()
});

adminRouter.get(
  "/users",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = usersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid users query", details: parsed.error.issues });
      return;
    }

    const { limit, offset } = parsed.data;
    const searchTerm = parsed.data.search?.trim() || null;
    const searchPattern = searchTerm ? `%${searchTerm}%` : null;

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::bigint AS total
        FROM users u
        WHERE (
          $1::text IS NULL
          OR u.username ILIKE $2
          OR u.email ILIKE $2
          OR COALESCE(u.company_name, '') ILIKE $2
        )
      `,
      [searchTerm, searchPattern]
    );

    const result = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.email,
          u.phone_number,
          u.company_name,
          u.user_role,
          u.is_active,
          u.created_at,
          u.last_login_at,
          COALESCE(s.active_session_count, 0)::int AS active_session_count,
          a.last_activity_at
        FROM users u
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS active_session_count
          FROM user_sessions s1
          WHERE s1.user_id = u.id
            AND s1.revoked_at IS NULL
            AND s1.expires_at > NOW()
        ) s ON TRUE
        LEFT JOIN LATERAL (
          SELECT MAX(a1.created_at) AS last_activity_at
          FROM user_activity_logs a1
          WHERE a1.user_id = u.id
        ) a ON TRUE
        WHERE (
          $1::text IS NULL
          OR u.username ILIKE $2
          OR u.email ILIKE $2
          OR COALESCE(u.company_name, '') ILIKE $2
        )
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $3 OFFSET $4
      `,
      [searchTerm, searchPattern, limit, offset]
    );

    await logUserActivity(
      "admin_users_viewed",
      { search: searchTerm, limit, offset, resultCount: result.rowCount },
      req.auth.userId
    );

    const total = Number((countResult.rows[0] as { total: string }).total);

    res.json({
      total,
      count: result.rowCount,
      users: result.rows.map((row) => ({
        id: Number(row.id),
        username: row.username as string,
        email: row.email as string,
        phoneNumber: row.phone_number as string,
        companyName: row.company_name as string,
        role: row.user_role === "admin" ? "admin" : "user",
        isActive: Boolean(row.is_active),
        createdAt: row.created_at as string,
        lastLoginAt: row.last_login_at as string | null,
        lastActivityAt: row.last_activity_at as string | null,
        activeSessionCount: Number(row.active_session_count ?? 0)
      }))
    });
  })
);

adminRouter.get(
  "/activity",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid activity query", details: parsed.error.issues });
      return;
    }

    const { limit, offset } = parsed.data;
    const userId = parsed.data.userId ?? null;
    const eventType = parsed.data.eventType?.trim() || null;

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::bigint AS total
        FROM user_activity_logs a
        WHERE ($1::bigint IS NULL OR a.user_id = $1)
          AND ($2::text IS NULL OR a.event_type = $2)
      `,
      [userId, eventType]
    );

    const result = await pool.query(
      `
        SELECT
          a.id,
          a.created_at,
          a.event_type,
          a.metadata,
          a.user_id,
          u.username,
          u.email,
          u.company_name
        FROM user_activity_logs a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE ($1::bigint IS NULL OR a.user_id = $1)
          AND ($2::text IS NULL OR a.event_type = $2)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $3 OFFSET $4
      `,
      [userId, eventType, limit, offset]
    );

    await logUserActivity(
      "admin_activity_viewed",
      { userId, eventType, limit, offset, resultCount: result.rowCount },
      req.auth.userId
    );

    const total = Number((countResult.rows[0] as { total: string }).total);

    res.json({
      total,
      count: result.rowCount,
      events: result.rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at as string,
        eventType: row.event_type as string,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        user: row.user_id
          ? {
              id: Number(row.user_id),
              username: (row.username as string | null) ?? "unknown",
              email: (row.email as string | null) ?? "",
              companyName: (row.company_name as string | null) ?? ""
            }
          : null
      }))
    });
  })
);

export default adminRouter;
