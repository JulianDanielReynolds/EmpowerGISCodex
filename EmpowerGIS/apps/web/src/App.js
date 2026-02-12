import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import AuthCard from "./components/AuthCard";
import AdminShell from "./components/AdminShell";
import DisclaimerGate from "./components/DisclaimerGate";
import MapShell from "./components/MapShell";
import { getCurrentUser, logout } from "./lib/api";
const DISCLAIMER_STORAGE_KEY = "empowergis_disclaimer_accepted";
const ACCESS_TOKEN_KEY = "empowergis_access_token";
const REFRESH_TOKEN_KEY = "empowergis_refresh_token";
function resolveViewFromPath(pathname) {
    return pathname.startsWith("/admin") ? "admin" : "map";
}
export default function App() {
    const [disclaimerAccepted, setDisclaimerAccepted] = useState(localStorage.getItem(DISCLAIMER_STORAGE_KEY) === "true");
    const [accessToken, setAccessToken] = useState(localStorage.getItem(ACCESS_TOKEN_KEY));
    const [refreshToken, setRefreshToken] = useState(localStorage.getItem(REFRESH_TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    const [view, setView] = useState(() => resolveViewFromPath(window.location.pathname));
    const storeSessionTokens = useCallback((tokens) => {
        localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
        setAccessToken(tokens.accessToken);
        setRefreshToken(tokens.refreshToken);
    }, []);
    const clearSessionTokens = useCallback(() => {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setAccessToken(null);
        setRefreshToken(null);
        setUser(null);
    }, []);
    const handleLogout = useCallback(async () => {
        const token = accessToken;
        if (token) {
            try {
                await logout(token);
            }
            catch {
                // Ignore remote logout failures on client signout.
            }
        }
        clearSessionTokens();
    }, [accessToken, clearSessionTokens]);
    useEffect(() => {
        const run = async () => {
            setIsCheckingSession(true);
            if (!accessToken) {
                setUser(null);
                setIsCheckingSession(false);
                return;
            }
            try {
                const currentUser = await getCurrentUser(accessToken, {
                    refreshToken,
                    onSessionTokensUpdated: storeSessionTokens
                });
                setUser(currentUser);
            }
            catch {
                await handleLogout();
            }
            finally {
                setIsCheckingSession(false);
            }
        };
        void run();
    }, [accessToken, refreshToken, handleLogout, storeSessionTokens]);
    useEffect(() => {
        const handlePopState = () => {
            setView(resolveViewFromPath(window.location.pathname));
        };
        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, []);
    const handleDisclaimerAccept = () => {
        localStorage.setItem(DISCLAIMER_STORAGE_KEY, "true");
        setDisclaimerAccepted(true);
    };
    const handleLoginSuccess = useCallback((tokens) => {
        storeSessionTokens(tokens);
    }, [storeSessionTokens]);
    const handleLogoutClick = useCallback(() => {
        void handleLogout();
    }, [handleLogout]);
    const navigateToView = useCallback((nextView) => {
        const targetPath = nextView === "admin" ? "/admin" : "/";
        if (window.location.pathname !== targetPath) {
            window.history.pushState({}, "", targetPath);
        }
        setView(nextView);
    }, []);
    if (isCheckingSession) {
        return _jsx("div", { className: "boot", children: "Checking session..." });
    }
    return (_jsxs(_Fragment, { children: [view === "admin" ? (_jsx(AdminShell, { user: user, accessToken: accessToken, refreshToken: refreshToken, onSessionTokensUpdated: storeSessionTokens, onBackToMap: () => navigateToView("map"), onLogout: handleLogoutClick })) : (_jsx(MapShell, { user: user, accessToken: accessToken, refreshToken: refreshToken, onSessionTokensUpdated: storeSessionTokens, onLogout: handleLogoutClick, ...(user?.role === "admin" ? { onOpenAdmin: () => navigateToView("admin") } : {}) })), !disclaimerAccepted ? _jsx(DisclaimerGate, { onAccept: handleDisclaimerAccept }) : null, disclaimerAccepted && !accessToken ? _jsx(AuthCard, { onLoginSuccess: handleLoginSuccess }) : null] }));
}
