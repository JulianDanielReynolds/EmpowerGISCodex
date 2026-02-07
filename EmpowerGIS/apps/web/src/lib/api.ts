const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  companyName: string;
  phoneNumber: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  session: {
    id: string;
    expiresAt: string;
  };
  user: AuthUser;
}

export interface LayerCatalogItem {
  key: string;
  name: string;
  geometryType: "fill" | "line" | "mixed";
  description: string;
  status: "ready" | "missing";
  latestVersion: {
    layerName: string;
    sourceName: string;
    sourceSnapshotDate: string | null;
    importedAt: string;
  } | null;
  tileTemplate: string;
}

export interface PropertyLookupResult {
  parcelKey: string;
  address: string;
  ownerName: string;
  ownerAddress?: string | null;
  legalDescription: string;
  acreage?: number | null;
  zoning: string;
  county?: string | null;
  landValue?: number | null;
  improvementValue?: number | null;
  marketValue?: number | null;
  coordinates: {
    longitude: number;
    latitude: number;
  };
}

export interface PropertySearchResult {
  parcelKey: string;
  address: string;
  ownerName: string;
  county: string | null;
  acreage: number | null;
  marketValue: number | null;
  zoning: string;
  longitude: number;
  latitude: number;
}

async function parseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({}));
  const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
  return new Error(message);
}

async function authorizedRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function register(payload: {
  username: string;
  email: string;
  password: string;
  phoneNumber: string;
  companyName: string;
}): Promise<{ user: AuthUser }> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      disclaimerAccepted: true
    })
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<{ user: AuthUser }>;
}

export async function login(payload: {
  username: string;
  password: string;
  deviceFingerprint?: string;
}): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<LoginResponse>;
}

export async function logout(accessToken: string): Promise<void> {
  await authorizedRequest<void>("/auth/logout", accessToken, {
    method: "POST"
  });
}

export async function getCurrentUser(accessToken: string): Promise<AuthUser> {
  return authorizedRequest<AuthUser>("/auth/me", accessToken);
}

export async function getLayerCatalog(accessToken: string): Promise<LayerCatalogItem[]> {
  const response = await authorizedRequest<{ layers: LayerCatalogItem[] }>("/layers", accessToken);
  return response.layers;
}

export async function getPropertyByCoordinates(
  accessToken: string,
  longitude: number,
  latitude: number
): Promise<PropertyLookupResult> {
  return authorizedRequest<PropertyLookupResult>(
    `/properties/by-coordinates?longitude=${longitude}&latitude=${latitude}`,
    accessToken
  );
}

export async function searchProperties(
  accessToken: string,
  query: string,
  limit = 10
): Promise<PropertySearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const response = await authorizedRequest<{ results: PropertySearchResult[] }>(
    `/properties/search?q=${encodedQuery}&limit=${limit}`,
    accessToken
  );
  return response.results;
}
