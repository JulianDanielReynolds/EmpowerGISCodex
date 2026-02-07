import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, "../config/layers.austin.json");
const outputDir = path.resolve(__dirname, "../output/tiles");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

fs.mkdirSync(outputDir, { recursive: true });

console.log("Starting tile build placeholder job");
console.log(`Region: ${config.region}`);
console.log(`Output directory: ${outputDir}`);

for (const layer of config.targetLayers) {
  const layerSources = config.sources[layer] ?? [];
  const layerDir = path.join(outputDir, layer);
  fs.mkdirSync(layerDir, { recursive: true });

  const metadata = {
    layer,
    sourceCount: layerSources.length,
    generatedAt: new Date().toISOString(),
    note: "Placeholder output. Replace with production MVT pipeline."
  };

  fs.writeFileSync(path.join(layerDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  console.log(`Prepared placeholder tile artifact for layer: ${layer}`);
}

console.log("Tile placeholder build complete.");
