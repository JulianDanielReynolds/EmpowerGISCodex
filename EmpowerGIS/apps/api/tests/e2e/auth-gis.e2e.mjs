import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

const apiRoot = process.cwd();
dotenv.config({ path: path.resolve(apiRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for API e2e tests");
}

const safeJwtSecret =
  process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length >= 32
    ? process.env.JWT_ACCESS_SECRET
    : "e2e-test-jwt-secret-with-minimum-length-123456789";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const username = `e2e_user_${runId}`;
const email = `${username}@example.com`;
const password = "E2ePassword12345";
const fixtureParcelKey = `E2E-PARCEL-${runId}`;
const fixtureZoningCode = `E2E-ZONE-${runId}`;
const fixtureAddress = `E2E ADDRESS ${runId}`;
const fixtureOwner = `E2E OWNER ${runId}`;
const fixtureJurisdiction = `E2E-JURISDICTION-${runId}`;
const fixtureLongitude = -122.40121;
const fixtureLatitude = 37.78519;
const polyDelta = 0.0011;
const fixturePolygonWkt = [
  `MULTIPOLYGON(((`,
  `${fixtureLongitude - polyDelta} ${fixtureLatitude - polyDelta},`,
  `${fixtureLongitude + polyDelta} ${fixtureLatitude - polyDelta},`,
  `${fixtureLongitude + polyDelta} ${fixtureLatitude + polyDelta},`,
  `${fixtureLongitude - polyDelta} ${fixtureLatitude + polyDelta},`,
  `${fixtureLongitude - polyDelta} ${fixtureLatitude - polyDelta}`,
  `)))`
].join("");

const port = 4200 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;

const db = new pg.Client({
  connectionString: databaseUrl
});

let apiProcess = null;
let recentApiLogs = "";
let insertedLayerVersionId = null;
let dbConnected = false;
let fixtureInserted = false;

function appendApiLog(chunk) {
  recentApiLogs += chunk.toString("utf8");
  if (recentApiLogs.length > 30_000) {
    recentApiLogs = recentApiLogs.slice(-30_000);
  }
}

function buildApiEnv() {
  return {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: safeJwtSecret,
    JWT_ACCESS_TTL_MINUTES: process.env.JWT_ACCESS_TTL_MINUTES ?? "15",
    REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS ?? "14",
    BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS ?? "10",
    CORS_ORIGINS: process.env.CORS_ORIGINS ?? "http://localhost:5173"
  };
}

async function waitForApiReady(timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = "unknown";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }

  throw new Error(`API did not become healthy (${lastError}). Recent logs:\n${recentApiLogs}`);
}

async function apiRequest(endpoint, options = {}) {
  const { method = "GET", accessToken, body } = options;
  const headers = {
    "Content-Type": "application/json"
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    status: response.status,
    payload,
    text
  };
}

async function apiBinaryRequest(endpoint, options = {}) {
  const { method = "GET", accessToken } = options;
  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: Buffer.from(await response.arrayBuffer())
  };
}

function lonLatToTileXY(longitude, latitude, zoom) {
  const latRad = (latitude * Math.PI) / 180;
  const tilesAtZoom = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * tilesAtZoom);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tilesAtZoom
  );
  return { x, y };
}

async function insertFixtureData() {
  const versionResult = await db.query(
    `
      INSERT INTO data_layer_versions (
        layer_key,
        layer_name,
        source_name,
        source_url,
        source_snapshot_date,
        metadata
      )
      VALUES (
        'zoning',
        'E2E Test Layer',
        'E2E test runner',
        'https://www.empowergis.com/e2e-tests',
        CURRENT_DATE,
        $1::jsonb
      )
      RETURNING id
    `,
    [JSON.stringify({ runId })]
  );
  insertedLayerVersionId = Number(versionResult.rows[0].id);

  await db.query(
    `
      INSERT INTO zoning_districts (
        zoning_code,
        zoning_label,
        jurisdiction,
        layer_version_id,
        geom
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        ST_GeomFromText($5, 4326)
      )
    `,
    [
      fixtureZoningCode,
      `E2E District ${runId}`,
      fixtureJurisdiction,
      insertedLayerVersionId,
      fixturePolygonWkt
    ]
  );

  await db.query(
    `
      INSERT INTO parcels (
        parcel_key,
        county_fips,
        county_name,
        situs_address,
        owner_name,
        owner_mailing_address,
        legal_description,
        acreage,
        land_value,
        improvement_value,
        market_value,
        zoning_code,
        layer_version_id,
        geom
      )
      VALUES (
        $1,
        '000',
        'E2E County',
        $2,
        $3,
        'E2E MAILING ADDRESS',
        'E2E parcel fixture',
        1.25,
        150000,
        350000,
        500000,
        $4,
        $5,
        ST_GeomFromText($6, 4326)
      )
    `,
    [
      fixtureParcelKey,
      fixtureAddress,
      fixtureOwner,
      fixtureZoningCode,
      insertedLayerVersionId,
      fixturePolygonWkt
    ]
  );
}

async function cleanupFixtureData() {
  const userResult = await db.query("SELECT id FROM users WHERE username = $1", [username]);
  const userId = userResult.rowCount > 0 ? Number(userResult.rows[0].id) : null;

  if (userId) {
    await db.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM user_terms_acceptance WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM user_activity_logs WHERE user_id = $1", [userId]);
  }

  await db.query("DELETE FROM users WHERE username = $1", [username]);
  await db.query("DELETE FROM parcels WHERE parcel_key = $1", [fixtureParcelKey]);
  await db.query("DELETE FROM zoning_districts WHERE jurisdiction = $1", [fixtureJurisdiction]);

  if (insertedLayerVersionId) {
    await db.query("DELETE FROM data_layer_versions WHERE id = $1", [insertedLayerVersionId]);
    insertedLayerVersionId = null;
  }
}

before(async () => {
  await db.connect();
  dbConnected = true;
  await insertFixtureData();
  fixtureInserted = true;

  apiProcess = spawn("node", ["dist/index.js"], {
    cwd: apiRoot,
    env: buildApiEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  apiProcess.stdout?.on("data", appendApiLog);
  apiProcess.stderr?.on("data", appendApiLog);

  await waitForApiReady();
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null && !apiProcess.killed) {
    apiProcess.kill("SIGTERM");
    await Promise.race([once(apiProcess, "exit"), delay(5_000)]);
    if (apiProcess.exitCode === null) {
      apiProcess.kill("SIGKILL");
      await once(apiProcess, "exit");
    }
  }

  if (fixtureInserted && dbConnected) {
    await cleanupFixtureData().catch(() => {});
  }

  if (dbConnected) {
    await db.end().catch(() => {});
    dbConnected = false;
  }
});

test("auth and GIS flows succeed end-to-end", async () => {
  const registerResponse = await apiRequest("/api/auth/register", {
    method: "POST",
    body: {
      username,
      email,
      password,
      phoneNumber: "555-0123",
      companyName: "E2E Corp",
      disclaimerAccepted: true
    }
  });
  assert.equal(registerResponse.status, 201, `register failed: ${registerResponse.text}`);
  assert.equal(registerResponse.payload?.user?.username, username);

  const loginOne = await apiRequest("/api/auth/login", {
    method: "POST",
    body: {
      username,
      password,
      deviceFingerprint: "e2e-device-one"
    }
  });
  assert.equal(loginOne.status, 200, `login one failed: ${loginOne.text}`);
  const firstAccessToken = loginOne.payload?.accessToken;
  const firstRefreshToken = loginOne.payload?.refreshToken;
  assert.ok(typeof firstAccessToken === "string" && firstAccessToken.length > 20);
  assert.ok(typeof firstRefreshToken === "string" && firstRefreshToken.length > 20);

  const loginTwo = await apiRequest("/api/auth/login", {
    method: "POST",
    body: {
      username,
      password,
      deviceFingerprint: "e2e-device-two"
    }
  });
  assert.equal(loginTwo.status, 200, `login two failed: ${loginTwo.text}`);
  const secondAccessToken = loginTwo.payload?.accessToken;
  const secondRefreshToken = loginTwo.payload?.refreshToken;
  assert.ok(typeof secondAccessToken === "string" && secondAccessToken.length > 20);
  assert.ok(typeof secondRefreshToken === "string" && secondRefreshToken.length > 20);

  const meWithFirstToken = await apiRequest("/api/auth/me", {
    accessToken: firstAccessToken
  });
  assert.equal(meWithFirstToken.status, 401);
  assert.equal(meWithFirstToken.payload?.error, "Session is no longer active");

  const meWithSecondToken = await apiRequest("/api/auth/me", {
    accessToken: secondAccessToken
  });
  assert.equal(meWithSecondToken.status, 200, `me second token failed: ${meWithSecondToken.text}`);
  assert.equal(meWithSecondToken.payload?.username, username);

  const refreshResponse = await apiRequest("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken: secondRefreshToken }
  });
  assert.equal(refreshResponse.status, 200, `refresh failed: ${refreshResponse.text}`);
  const rotatedAccessToken = refreshResponse.payload?.accessToken;
  const rotatedRefreshToken = refreshResponse.payload?.refreshToken;
  assert.ok(typeof rotatedAccessToken === "string" && rotatedAccessToken.length > 20);
  assert.ok(typeof rotatedRefreshToken === "string" && rotatedRefreshToken.length > 20);
  assert.notEqual(rotatedRefreshToken, secondRefreshToken);

  const refreshWithOldToken = await apiRequest("/api/auth/refresh", {
    method: "POST",
    body: { refreshToken: secondRefreshToken }
  });
  assert.equal(refreshWithOldToken.status, 401);

  const layersResponse = await apiRequest("/api/layers", {
    accessToken: rotatedAccessToken
  });
  assert.equal(layersResponse.status, 200, `layers failed: ${layersResponse.text}`);
  assert.equal(Array.isArray(layersResponse.payload?.layers), true);
  assert.equal(layersResponse.payload.layers.length, 8);

  const searchResponse = await apiRequest(
    `/api/properties/search?q=${encodeURIComponent(fixtureAddress)}&limit=5`,
    { accessToken: rotatedAccessToken }
  );
  assert.equal(searchResponse.status, 200, `search failed: ${searchResponse.text}`);
  assert.ok(Array.isArray(searchResponse.payload?.results));
  const matchedParcel = searchResponse.payload.results.find((result) => result.parcelKey === fixtureParcelKey);
  assert.ok(matchedParcel, `expected parcel ${fixtureParcelKey} in search results`);

  const lookupResponse = await apiRequest(
    `/api/properties/by-coordinates?longitude=${fixtureLongitude}&latitude=${fixtureLatitude}`,
    { accessToken: rotatedAccessToken }
  );
  assert.equal(lookupResponse.status, 200, `lookup failed: ${lookupResponse.text}`);
  assert.equal(lookupResponse.payload?.parcelKey, fixtureParcelKey);
  assert.equal(lookupResponse.payload?.zoning, fixtureZoningCode);

  const tileZoom = 14;
  const { x: tileX, y: tileY } = lonLatToTileXY(fixtureLongitude, fixtureLatitude, tileZoom);
  const tileResponse = await apiBinaryRequest(`/tiles/zoning/${tileZoom}/${tileX}/${tileY}.pbf`);
  assert.equal(tileResponse.status, 200);
  assert.equal(tileResponse.contentType, "application/x-protobuf");
  assert.ok(tileResponse.body.length > 2, "expected non-empty zoning vector tile");
});
