import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  TILE_BASE_URL: z.string().url().optional(),
  TILE_MAX_FEATURES: z.coerce.number().int().min(100).max(100_000).default(10_000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Invalid API environment configuration: ${details}`);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
