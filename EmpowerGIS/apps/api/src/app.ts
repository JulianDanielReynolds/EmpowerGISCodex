import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { corsOrigins } from "./config/env.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import propertiesRouter from "./routes/properties.js";
import layersRouter from "./routes/layers.js";
import tilesRouter from "./routes/tiles.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      max: 240,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/properties", propertiesRouter);
  app.use("/api/layers", layersRouter);
  app.use("/tiles", tilesRouter);

  app.get("/api", (_req, res) => {
    res.json({
      service: "empowergis-api",
      version: "0.1.0",
      endpoints: {
        health: "/api/health",
        ready: "/api/ready",
        auth: [
          "POST /api/auth/register",
          "POST /api/auth/login",
          "POST /api/auth/refresh",
          "POST /api/auth/logout",
          "POST /api/auth/logout-all",
          "GET /api/auth/me"
        ],
        admin: [
          "GET /api/admin/users",
          "GET /api/admin/activity"
        ],
        properties: [
          "GET /api/properties/by-coordinates?longitude=&latitude=",
          "GET /api/properties/search?q=",
          "GET /api/properties/bounds?west=&south=&east=&north=",
          "GET /api/properties/stats"
        ],
        layers: ["GET /api/layers"],
        tiles: [
          "GET /tiles",
          "GET /tiles/:layer/metadata.json",
          "GET /tiles/:layer/:z/:x/:y.pbf"
        ]
      }
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
