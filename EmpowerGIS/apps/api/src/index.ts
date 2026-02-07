import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./config/database.js";

async function startServer() {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`EmpowerGIS API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down API...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("API failed to start", error);
  process.exit(1);
});
