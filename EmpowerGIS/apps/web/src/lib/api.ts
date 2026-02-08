const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthRequestOptions {
  refreshToken?: string | null;
  onSessionTokensUpdated?: (tokens: SessionTokens) => void;
}

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

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let refreshInFlight: Promise<SessionTokens> | null = null;
let refreshInFlightForToken: string | null = null;

type ApiErrorDetail = {
  message?: string;
};

type ApiErrorPayload = {
  error?: unknown;
  details?: unknown;
};

function normalizeRequestError(error: unknown): Error {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof TypeError) {
    return new Error(
      `Unable to reach the EmpowerGIS API at ${API_BASE_URL}. ` +
        "Confirm the API is running (`npm run dev:api`) and VITE_API_BASE_URL is correct."
    );
  }

  return error instanceof Error ? error : new Error("Request failed");
}

async function parseError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => ({} as ApiErrorPayload)) as ApiErrorPayload;
  const baseMessage = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
  const detailMessage = Array.isArray(payload.details)
    ? payload.details
        .map((detail: unknown) => {
          const parsed = detail as ApiErrorDetail | null;
          if (parsed && typeof parsed.message === "string") {
            return parsed.message;
          }
          if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message?: unknown }).message === "string") {
            return (detail as { message: string }).message;
          }
          if (typeof detail === "string") {
            return detail;
          }
          return null;
        })
        .filter((message: string | null): message is string => Boolean(message))
        .join("; ")
    : "";

  const message = detailMessage ? `${baseMessage}: ${detailMessage}` : baseMessage;
  return new ApiError(response.status, message);
}

async function executeAuthorizedRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  try {
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
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

async function refreshAccessToken(refreshToken: string): Promise<SessionTokens> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) {
      throw await parseError(response);
    }

    const payload = await response.json().catch(() => ({})) as Partial<SessionTokens>;
    if (typeof payload.accessToken !== "string" || typeof payload.refreshToken !== "string") {
      throw new Error("Invalid refresh response from API");
    }

    return {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken
    };
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

async function refreshWithLock(refreshToken: string): Promise<SessionTokens> {
  if (refreshInFlight && refreshInFlightForToken === refreshToken) {
    return refreshInFlight;
  }

  refreshInFlightForToken = refreshToken;
  refreshInFlight = refreshAccessToken(refreshToken);

  try {
    return await refreshInFlight;
  } finally {
    if (refreshInFlightForToken === refreshToken) {
      refreshInFlight = null;
      refreshInFlightForToken = null;
    }
  }
}

async function authorizedRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
  options?: AuthRequestOptions
): Promise<T> {
  try {
    return await executeAuthorizedRequest<T>(path, accessToken, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !options?.refreshToken) {
      throw error;
    }

    const rotatedTokens = await refreshWithLock(options.refreshToken);
    options.onSessionTokensUpdated?.(rotatedTokens);
    return executeAuthorizedRequest<T>(path, rotatedTokens.accessToken, init);
  }
}

export async function register(payload: {
  username: string;
  email: string;
  password: string;
  phoneNumber: string;
  companyName: string;
}): Promise<{ user: AuthUser }> {
  try {
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
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function login(payload: {
  username: string;
  password: string;
  deviceFingerprint?: string;
}): Promise<LoginResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw await parseError(response);
    }

    return response.json() as Promise<LoginResponse>;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function logout(accessToken: string): Promise<void> {
  await executeAuthorizedRequest<void>("/auth/logout", accessToken, {
    method: "POST"
  });
}

export async function getCurrentUser(accessToken: string, options?: AuthRequestOptions): Promise<AuthUser> {
  return authorizedRequest<AuthUser>("/auth/me", accessToken, undefined, options);
}

export async function getLayerCatalog(accessToken: string, options?: AuthRequestOptions): Promise<LayerCatalogItem[]> {
  const response = await authorizedRequest<{ layers: LayerCatalogItem[] }>("/layers", accessToken, undefined, options);
  return response.layers;
}

export async function getPropertyByCoordinates(
  accessToken: string,
  longitude: number,
  latitude: number,
  options?: AuthRequestOptions
): Promise<PropertyLookupResult> {
  return authorizedRequest<PropertyLookupResult>(
    `/properties/by-coordinates?longitude=${longitude}&latitude=${latitude}`,
    accessToken,
    undefined,
    options
  );
}

export async function searchProperties(
  accessToken: string,
  query: string,
  limit = 10,
  options?: AuthRequestOptions
): Promise<PropertySearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const response = await authorizedRequest<{ results: PropertySearchResult[] }>(
    `/properties/search?q=${encodedQuery}&limit=${limit}`,
    accessToken,
    undefined,
    options
  );
  return response.results;
}
