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
async function parseError(response) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    return new ApiError(response.status, message);
}
async function executeAuthorizedRequest(path, accessToken, init) {
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
async function refreshAccessToken(refreshToken) {
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
export async function login(payload) {
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
export async function searchProperties(accessToken, query, limit = 10, options) {
    const encodedQuery = encodeURIComponent(query);
    const response = await authorizedRequest(`/properties/search?q=${encodedQuery}&limit=${limit}`, accessToken, undefined, options);
    return response.results;
}
