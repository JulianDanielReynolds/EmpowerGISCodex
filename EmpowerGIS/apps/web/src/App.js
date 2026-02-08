import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import AuthCard from "./components/AuthCard";
import DisclaimerGate from "./components/DisclaimerGate";
import MapShell from "./components/MapShell";
import { getCurrentUser, logout } from "./lib/api";
const DISCLAIMER_STORAGE_KEY = "empowergis_disclaimer_accepted";
const ACCESS_TOKEN_KEY = "empowergis_access_token";
const REFRESH_TOKEN_KEY = "empowergis_refresh_token";
export default function App() {
    const [disclaimerAccepted, setDisclaimerAccepted] = useState(localStorage.getItem(DISCLAIMER_STORAGE_KEY) === "true");
    const [accessToken, setAccessToken] = useState(localStorage.getItem(ACCESS_TOKEN_KEY));
    const [refreshToken, setRefreshToken] = useState(localStorage.getItem(REFRESH_TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
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
    if (isCheckingSession) {
        return _jsx("div", { className: "boot", children: "Checking session..." });
    }
    return (_jsxs(_Fragment, { children: [_jsx(MapShell, { user: user, accessToken: accessToken, refreshToken: refreshToken, onSessionTokensUpdated: storeSessionTokens, onLogout: handleLogoutClick }), !disclaimerAccepted ? _jsx(DisclaimerGate, { onAccept: handleDisclaimerAccept }) : null, disclaimerAccepted && !accessToken ? _jsx(AuthCard, { onLoginSuccess: handleLoginSuccess }) : null] }));
}
