import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { env } from "../config/env.js";

const tilesRouter = Router();

const LEGACY_TILES_DIR = "/Users/julianreynolds/austin-gis-platform/data/tiles";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..", "..");
const PROJECT_TILES_DIR = path.resolve(appRoot, "..", "..", "data-pipeline", "output", "tiles");

function resolveTilesDir(): string {
  const candidates = [env.TILES_DIR, PROJECT_TILES_DIR, LEGACY_TILES_DIR].filter(Boolean) as string[];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? PROJECT_TILES_DIR;
}

const TILES_DIR = resolveTilesDir();

const VALID_LAYERS = new Set([
  "floodplain",
  "contours",
  "zoning",
  "water-infrastructure",
  "sewer-infrastructure",
  "cities-etj",
  "opportunity-zones",
  "parcels",
  "watersheds",
  "address-points"
]);

const EMPTY_TILE = Buffer.from([0x1a, 0x00]);

function normalizeLayer(layer: string): string {
  if (layer === "floodplain") return "flood-zones";
  return layer;
}

tilesRouter.get("/", (_req, res) => {
  const layers = Array.from(VALID_LAYERS).map((layer) => {
    const normalized = normalizeLayer(layer);
    const layerPath = path.join(TILES_DIR, normalized);
    return {
      key: layer,
      path: layerPath,
      available: fs.existsSync(layerPath)
    };
  });

  res.json({
    tilesDir: TILES_DIR,
    layers
  });
});

tilesRouter.get("/:layer/metadata.json", (req, res) => {
  const layer = req.params.layer;
  if (!VALID_LAYERS.has(layer)) {
    res.status(404).json({ error: "Layer not found" });
    return;
  }

  const normalized = normalizeLayer(layer);
  const metadataPath = path.join(TILES_DIR, normalized, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    res.status(404).json({ error: "Metadata not found" });
    return;
  }

  res.sendFile(metadataPath);
});

tilesRouter.get("/:layer/:z/:x/:y.pbf", (req, res) => {
  const { layer, z, x, y } = req.params;
  if (!VALID_LAYERS.has(layer)) {
    res.status(404).json({ error: "Layer not found" });
    return;
  }

  const normalized = normalizeLayer(layer);
  const tilePath = path.join(TILES_DIR, normalized, z, x, `${y}.pbf`);
  res.set("Content-Type", "application/x-protobuf");
  res.set("Cache-Control", "public, max-age=86400");

  if (!fs.existsSync(tilePath)) {
    res.send(EMPTY_TILE);
    return;
  }

  const stream = fs.createReadStream(tilePath);
  stream.on("error", () => {
    res.status(500).json({ error: "Failed to read tile" });
  });
  stream.pipe(res);
});

export default tilesRouter;
