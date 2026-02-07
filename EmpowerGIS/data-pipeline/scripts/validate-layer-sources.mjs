import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, "../config/layers.austin.json");
const repoRoot = path.resolve(__dirname, "..", "..");
const projectSourceRoot = path.resolve(repoRoot, "data", "raw");
const legacySourceRoot = "/Users/julianreynolds/austin-gis-platform/data/raw";

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function resolveSourceRoot() {
  const candidates = [process.env.DATA_SOURCE_ROOT, projectSourceRoot, legacySourceRoot].filter(Boolean);
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? candidates[0];
}

function resolveSourcePath(filePath, sourceRoot) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(sourceRoot, filePath);
}

const sourceRoot = resolveSourceRoot();
console.log(`Using source root: ${sourceRoot}`);
let missingCount = 0;

for (const [layer, files] of Object.entries(config.sources)) {
  for (const filePath of files) {
    const resolvedPath = resolveSourcePath(filePath, sourceRoot);
    if (!fs.existsSync(resolvedPath)) {
      missingCount += 1;
      console.error(`[missing] ${layer}: ${resolvedPath}`);
    } else {
      console.log(`[ok] ${layer}: ${resolvedPath}`);
    }
  }
}

if (missingCount > 0) {
  console.error(`Found ${missingCount} missing layer source file(s).`);
  process.exit(1);
}

console.log("All configured layer sources are present.");
