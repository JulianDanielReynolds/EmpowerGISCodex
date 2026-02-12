const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}
let refreshInFlight = null;
let refreshInFlightForToken = null;
function normalizeRequestError(error) {
    if (error instanceof ApiError) {
        return error;
    }
    if (error instanceof TypeError) {
        return new Error(`Unable to reach the EmpowerGIS API at ${API_BASE_URL}. ` +
            "Confirm the API is running (`npm run dev:api`) and VITE_API_BASE_URL is correct.");
    }
    return error instanceof Error ? error : new Error("Request failed");
}
async function parseError(response) {
    const payload = await response.json().catch(() => ({}));
    const baseMessage = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    const detailMessage = Array.isArray(payload.details)
        ? payload.details
            .map((detail) => {
            const parsed = detail;
            if (parsed && typeof parsed.message === "string") {
                return parsed.message;
            }
            if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
                return detail.message;
            }
            if (typeof detail === "string") {
                return detail;
            }
            return null;
        })
            .filter((message) => Boolean(message))
            .join("; ")
        : "";
    const message = detailMessage ? `${baseMessage}: ${detailMessage}` : baseMessage;
    return new ApiError(response.status, message);
}
async function executeAuthorizedRequest(path, accessToken, init) {
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
            return undefined;
        }
        return response.json();
    }
    catch (error) {
        throw normalizeRequestError(error);
    }
}
async function refreshAccessToken(refreshToken) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken })
        });
        if (!response.ok) {
            throw await parseError(response);
        }
        const payload = await response.json().catch(() => ({}));
        if (typeof payload.accessToken !== "string" || typeof payload.refreshToken !== "string") {
            throw new Error("Invalid refresh response from API");
        }
        return {
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken
        };
    }
    catch (error) {
        throw normalizeRequestError(error);
    }
}
async function refreshWithLock(refreshToken) {
    if (refreshInFlight && refreshInFlightForToken === refreshToken) {
        return refreshInFlight;
    }
    refreshInFlightForToken = refreshToken;
    refreshInFlight = refreshAccessToken(refreshToken);
    try {
        return await refreshInFlight;
    }
    finally {
        if (refreshInFlightForToken === refreshToken) {
            refreshInFlight = null;
            refreshInFlightForToken = null;
        }
    }
}
async function authorizedRequest(path, accessToken, init, options) {
    try {
        return await executeAuthorizedRequest(path, accessToken, init);
    }
    catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401 || !options?.refreshToken) {
            throw error;
        }
        const rotatedTokens = await refreshWithLock(options.refreshToken);
        options.onSessionTokensUpdated?.(rotatedTokens);
        return executeAuthorizedRequest(path, rotatedTokens.accessToken, init);
    }
}
export async function register(payload) {
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
        return response.json();
    }
    catch (error) {
        throw normalizeRequestError(error);
    }
}
export async function login(payload) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw await parseError(response);
        }
        return response.json();
    }
    catch (error) {
        throw normalizeRequestError(error);
    }
}
export async function logout(accessToken) {
    await executeAuthorizedRequest("/auth/logout", accessToken, {
        method: "POST"
    });
}
export async function getCurrentUser(accessToken, options) {
    return authorizedRequest("/auth/me", accessToken, undefined, options);
}
export async function getLayerCatalog(accessToken, options) {
    const response = await authorizedRequest("/layers", accessToken, undefined, options);
    return response.layers;
}
export async function getPropertyByCoordinates(accessToken, longitude, latitude, options) {
    return authorizedRequest(`/properties/by-coordinates?longitude=${longitude}&latitude=${latitude}`, accessToken, undefined, options);
}
export async function getPropertyByParcelKey(accessToken, parcelKey, options) {
    const encodedParcelKey = encodeURIComponent(parcelKey);
    return authorizedRequest(`/properties/by-parcel-key/${encodedParcelKey}`, accessToken, undefined, options);
}
export async function searchProperties(accessToken, query, limit = 10, options) {
    const encodedQuery = encodeURIComponent(query);
    const response = await authorizedRequest(`/properties/search?q=${encodedQuery}&limit=${limit}`, accessToken, undefined, options);
    return response.results;
}
export async function getAdminUsers(accessToken, options) {
    const params = new URLSearchParams();
    if (options?.limit)
        params.set("limit", String(options.limit));
    if (options?.offset)
        params.set("offset", String(options.offset));
    if (options?.search)
        params.set("search", options.search);
    const query = params.toString();
    return authorizedRequest(`/admin/users${query ? `?${query}` : ""}`, accessToken, undefined, options);
}
export async function getAdminActivity(accessToken, options) {
    const params = new URLSearchParams();
    if (options?.limit)
        params.set("limit", String(options.limit));
    if (options?.offset)
        params.set("offset", String(options.offset));
    if (options?.userId)
        params.set("userId", String(options.userId));
    if (options?.eventType)
        params.set("eventType", options.eventType);
    const query = params.toString();
    return authorizedRequest(`/admin/activity${query ? `?${query}` : ""}`, accessToken, undefined, options);
}
