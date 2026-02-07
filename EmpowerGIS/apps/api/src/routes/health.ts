import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { checkDatabaseReadiness } from "../config/database.js";

const healthRouter = Router();

healthRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json({
      status: "ok",
      service: "empowergis-api",
      timestamp: new Date().toISOString()
    });
  })
);

healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const dbReady = await checkDatabaseReadiness();

    if (!dbReady) {
      res.status(503).json({
        status: "degraded",
        dependencies: { database: "down" }
      });
      return;
    }

    res.json({
      status: "ready",
      dependencies: { database: "up" },
      timestamp: new Date().toISOString()
    });
  })
);

export default healthRouter;
