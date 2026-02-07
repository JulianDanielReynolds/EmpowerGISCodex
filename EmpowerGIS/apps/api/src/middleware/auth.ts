import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";

interface AccessTokenPayload {
  sub: string;
  sid: string;
  username: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: number;
    sessionId: string;
    username: string;
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || !payload.sid) {
    res.status(401).json({ error: "Invalid token payload" });
    return;
  }

  const sessionResult = await pool.query(
    `
      SELECT s.id, s.user_id, u.username
      FROM user_sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.user_id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = TRUE
      LIMIT 1
    `,
    [payload.sid, userId]
  );

  if (sessionResult.rowCount === 0) {
    res.status(401).json({ error: "Session is no longer active" });
    return;
  }

  req.auth = {
    userId,
    sessionId: payload.sid,
    username: payload.username
  };

  await pool.query("UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1", [payload.sid]);
  next();
}
