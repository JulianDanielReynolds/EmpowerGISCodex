const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
async function parseError(response) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    return new Error(message);
}
async function authorizedRequest(path, accessToken, init) {
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
    await authorizedRequest("/auth/logout", accessToken, {
        method: "POST"
    });
}
export async function getCurrentUser(accessToken) {
    return authorizedRequest("/auth/me", accessToken);
}
export async function getLayerCatalog(accessToken) {
    const response = await authorizedRequest("/layers", accessToken);
    return response.layers;
}
export async function getPropertyByCoordinates(accessToken, longitude, latitude) {
    return authorizedRequest(`/properties/by-coordinates?longitude=${longitude}&latitude=${latitude}`, accessToken);
}
export async function searchProperties(accessToken, query, limit = 10) {
    const encodedQuery = encodeURIComponent(query);
    const response = await authorizedRequest(`/properties/search?q=${encodedQuery}&limit=${limit}`, accessToken);
    return response.results;
}
