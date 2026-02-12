import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";
import { asyncHandler } from "../lib/http.js";
import { generateRefreshToken, hashToken } from "../lib/crypto.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { logUserActivity } from "../services/activity.js";

const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." }
});

const registerSchema = z.object({
  username: z.string().trim().min(3).max(50),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(10).max(128),
  phoneNumber: z.string().trim().min(7).max(50),
  companyName: z.string().trim().min(2).max(255),
  disclaimerAccepted: z.literal(true)
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceFingerprint: z.string().trim().max(255).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

function issueAccessToken(params: { userId: number; sessionId: string; username: string }) {
  return jwt.sign(
    {
      sub: String(params.userId),
      sid: params.sessionId,
      username: params.username
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: `${env.JWT_ACCESS_TTL_MINUTES}m` }
  );
}

authRouter.post(
  "/register",
  registerLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid registration payload", details: parsed.error.issues });
      return;
    }

    const { username, email, password, phoneNumber, companyName } = parsed.data;
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const result = await pool.query(
      `
        INSERT INTO users (username, email, password_hash, phone_number, company_name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING id, username, email, phone_number, company_name, user_role, created_at
      `,
      [username, email, passwordHash, phoneNumber, companyName]
    );

    if (result.rowCount === 0) {
      res.status(409).json({ error: "Username or email already exists" });
      return;
    }

    const user = result.rows[0] as {
      id: string | number;
      username: string;
      email: string;
      phone_number: string;
      company_name: string;
      user_role: string;
      created_at: string;
    };
    const userId = Number(user.id);

    await pool.query(
      `
        INSERT INTO user_terms_acceptance (user_id, terms_version)
        VALUES ($1, 'v1')
      `,
      [userId]
    );

    await logUserActivity("user_registered", { username: user.username }, userId);

    res.status(201).json({
      user: {
        id: userId,
        username: user.username,
        email: user.email,
        phoneNumber: user.phone_number,
        companyName: user.company_name,
        role: user.user_role === "admin" ? "admin" : "user",
        createdAt: user.created_at
      }
    });
  })
);

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid login payload", details: parsed.error.issues });
      return;
    }

    const { username, password, deviceFingerprint } = parsed.data;
    const ipAddress = req.ip ?? null;
    const userAgent = req.get("user-agent") ?? null;

    const userResult = await pool.query(
      `
        SELECT id, username, email, password_hash, is_active, company_name, phone_number, user_role
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    if (userResult.rowCount === 0) {
      await logUserActivity("login_failed", { username, reason: "user_not_found" });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = userResult.rows[0] as {
      id: string | number;
      username: string;
      email: string;
      password_hash: string;
      is_active: boolean;
      company_name: string;
      phone_number: string;
      user_role: string;
    };
    const userId = Number(user.id);

    if (!user.is_active) {
      await logUserActivity("login_failed", { username, reason: "inactive_user" }, userId);
      res.status(403).json({ error: "Account is inactive" });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      await pool.query("UPDATE users SET last_failed_login_at = NOW() WHERE id = $1", [userId]);
      await logUserActivity("login_failed", { username, reason: "bad_password" }, userId);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          UPDATE user_sessions
          SET revoked_at = NOW(),
              revoked_reason = 'replaced_by_new_login'
          WHERE user_id = $1
            AND revoked_at IS NULL
        `,
        [userId]
      );

      const sessionResult = await client.query(
        `
          INSERT INTO user_sessions (
            user_id,
            refresh_token_hash,
            expires_at,
            ip_address,
            user_agent,
            device_fingerprint
          )
          VALUES (
            $1,
            $2,
            NOW() + ($3::int * INTERVAL '1 day'),
            $4::inet,
            $5,
            $6
          )
          RETURNING id, expires_at
        `,
        [userId, refreshTokenHash, env.REFRESH_TOKEN_TTL_DAYS, ipAddress, userAgent, deviceFingerprint ?? null]
      );

      await client.query("UPDATE users SET last_login_at = NOW(), last_failed_login_at = NULL WHERE id = $1", [userId]);
      await client.query("COMMIT");

      const session = sessionResult.rows[0] as { id: string; expires_at: string };
      const accessToken = issueAccessToken({
        userId,
        sessionId: session.id,
        username: user.username
      });

      await logUserActivity("login_success", { username: user.username, sessionId: session.id }, userId);

      res.json({
        accessToken,
        refreshToken,
        session: {
          id: session.id,
          expiresAt: session.expires_at
        },
        user: {
          id: userId,
          username: user.username,
          email: user.email,
          companyName: user.company_name,
          phoneNumber: user.phone_number,
          role: user.user_role === "admin" ? "admin" : "user"
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid refresh payload" });
      return;
    }

    const incomingHash = hashToken(parsed.data.refreshToken);
    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = hashToken(newRefreshToken);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query(
        `
          SELECT s.id, s.user_id, u.username
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.refresh_token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > NOW()
            AND u.is_active = TRUE
          FOR UPDATE
        `,
        [incomingHash]
      );

      if (sessionResult.rowCount === 0) {
        await client.query("ROLLBACK");
        res.status(401).json({ error: "Refresh token is invalid or expired" });
        return;
      }

      const session = sessionResult.rows[0] as { id: string; user_id: string | number; username: string };
      const userId = Number(session.user_id);
      await client.query(
        `
          UPDATE user_sessions
          SET refresh_token_hash = $1,
              last_seen_at = NOW()
          WHERE id = $2
        `,
        [newRefreshHash, session.id]
      );

      await client.query("COMMIT");

      const accessToken = issueAccessToken({
        userId,
        sessionId: session.id,
        username: session.username
      });

      res.json({
        accessToken,
        refreshToken: newRefreshToken
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    await pool.query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW(),
            revoked_reason = 'logout'
        WHERE id = $1
      `,
      [req.auth.sessionId]
    );

    await logUserActivity("logout", { sessionId: req.auth.sessionId }, req.auth.userId);
    res.status(204).send();
  })
);

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    await pool.query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW(),
            revoked_reason = 'logout_all'
        WHERE user_id = $1
          AND revoked_at IS NULL
      `,
      [req.auth.userId]
    );

    await logUserActivity("logout_all", {}, req.auth.userId);
    res.status(204).send();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const result = await pool.query(
      `
        SELECT id, username, email, phone_number, company_name, user_role, created_at, last_login_at
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.auth.userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = result.rows[0] as {
      id: string | number;
      username: string;
      email: string;
      phone_number: string;
      company_name: string;
      user_role: string;
      created_at: string;
      last_login_at: string | null;
    };

    res.json({
      id: Number(user.id),
      username: user.username,
      email: user.email,
      phoneNumber: user.phone_number,
      companyName: user.company_name,
      role: user.user_role === "admin" ? "admin" : "user",
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at
    });
  })
);

export default authRouter;
