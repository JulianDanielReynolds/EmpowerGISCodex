import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
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
    const [user, setUser] = useState(null);
    const [isCheckingSession, setIsCheckingSession] = useState(true);
    useEffect(() => {
        const run = async () => {
            if (!accessToken) {
                setIsCheckingSession(false);
                return;
            }
            try {
                const currentUser = await getCurrentUser(accessToken);
                setUser(currentUser);
            }
            catch {
                handleLogout();
            }
            finally {
                setIsCheckingSession(false);
            }
        };
        void run();
    }, [accessToken]);
    const handleDisclaimerAccept = () => {
        localStorage.setItem(DISCLAIMER_STORAGE_KEY, "true");
        setDisclaimerAccepted(true);
    };
    const handleLoginSuccess = (tokens) => {
        localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
        setAccessToken(tokens.accessToken);
    };
    const handleLogout = async () => {
        const token = accessToken;
        if (token) {
            try {
                await logout(token);
            }
            catch {
                // Ignore remote logout failures on client signout.
            }
        }
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setAccessToken(null);
        setUser(null);
    };
    if (isCheckingSession) {
        return _jsx("div", { className: "boot", children: "Checking session..." });
    }
    return (_jsxs(_Fragment, { children: [_jsx(MapShell, { user: user, accessToken: accessToken, onLogout: () => void handleLogout() }), !disclaimerAccepted ? _jsx(DisclaimerGate, { onAccept: handleDisclaimerAccept }) : null, disclaimerAccepted && !accessToken ? _jsx(AuthCard, { onLoginSuccess: handleLoginSuccess }) : null] }));
}
