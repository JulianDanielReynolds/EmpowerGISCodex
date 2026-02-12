import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAdminActivity, getAdminUsers } from "../lib/api";
function formatDateTime(value) {
    if (!value)
        return "N/A";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    return parsed.toLocaleString();
}
function formatMetadata(value) {
    const entries = Object.entries(value);
    if (entries.length === 0)
        return "{}";
    return JSON.stringify(value);
}
export default function AdminShell({ user, accessToken, refreshToken, onSessionTokensUpdated, onLogout, onBackToMap }) {
    const [users, setUsers] = useState([]);
    const [events, setEvents] = useState([]);
    const [usersTotal, setUsersTotal] = useState(0);
    const [eventsTotal, setEventsTotal] = useState(0);
    const [searchInput, setSearchInput] = useState("");
    const [searchFilter, setSearchFilter] = useState("");
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [isLoadingEvents, setIsLoadingEvents] = useState(false);
    const [error, setError] = useState(null);
    const authRequestOptions = useMemo(() => ({
        refreshToken,
        onSessionTokensUpdated
    }), [refreshToken, onSessionTokensUpdated]);
    const loadUsers = useCallback(async () => {
        if (!accessToken || user?.role !== "admin")
            return;
        setIsLoadingUsers(true);
        setError(null);
        try {
            const requestOptions = {
                ...authRequestOptions,
                limit: 300,
                ...(searchFilter ? { search: searchFilter } : {})
            };
            const response = await getAdminUsers(accessToken, {
                ...requestOptions
            });
            setUsers(response.users);
            setUsersTotal(response.total);
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load users");
        }
        finally {
            setIsLoadingUsers(false);
        }
    }, [accessToken, authRequestOptions, searchFilter, user?.role]);
    const loadActivity = useCallback(async () => {
        if (!accessToken || user?.role !== "admin")
            return;
        setIsLoadingEvents(true);
        setError(null);
        try {
            const response = await getAdminActivity(accessToken, {
                ...authRequestOptions,
                limit: 250
            });
            setEvents(response.events);
            setEventsTotal(response.total);
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load activity logs");
        }
        finally {
            setIsLoadingEvents(false);
        }
    }, [accessToken, authRequestOptions, user?.role]);
    useEffect(() => {
        if (!accessToken || user?.role !== "admin")
            return;
        void loadUsers();
        void loadActivity();
    }, [accessToken, user?.role, loadUsers, loadActivity]);
    const handleSearch = () => {
        setSearchFilter(searchInput.trim());
    };
    useEffect(() => {
        if (!accessToken || user?.role !== "admin")
            return;
        void loadUsers();
    }, [searchFilter, accessToken, user?.role, loadUsers]);
    if (!accessToken) {
        return (_jsx("main", { className: "app-layout", children: _jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("h1", { children: "EmpowerGIS Admin" }), _jsx("p", { children: "Sign in to view registered users and activity." })] }), _jsx("div", { className: "top-bar-right", children: _jsx("button", { className: "ghost", onClick: onBackToMap, children: "Back to Map" }) })] }) }));
    }
    if (user?.role !== "admin") {
        return (_jsxs("main", { className: "app-layout", children: [_jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("h1", { children: "EmpowerGIS Admin" }), _jsx("p", { children: "Admin access is required." })] }), _jsxs("div", { className: "top-bar-right", children: [_jsx("span", { children: user?.username ?? "Unknown user" }), _jsx("button", { className: "ghost", onClick: onBackToMap, children: "Back to Map" }), _jsx("button", { className: "ghost", onClick: onLogout, children: "Logout" })] })] }), _jsx("section", { className: "admin-content", children: _jsx("aside", { className: "panel", children: _jsx("p", { className: "error", children: "Your account is not an admin. Ask an existing admin to grant your account admin access." }) }) })] }));
    }
    const isLoading = isLoadingUsers || isLoadingEvents;
    return (_jsxs("main", { className: "app-layout", children: [_jsxs("header", { className: "top-bar", children: [_jsxs("div", { children: [_jsx("h1", { children: "EmpowerGIS Admin" }), _jsx("p", { children: "User registrations and activity monitoring" })] }), _jsxs("div", { className: "top-bar-right", children: [_jsx("span", { children: user.username }), _jsx("button", { className: "ghost", onClick: onBackToMap, children: "Back to Map" }), _jsx("button", { className: "ghost", onClick: onLogout, children: "Logout" })] })] }), _jsxs("section", { className: "admin-content", children: [_jsxs("div", { className: "admin-toolbar", children: [_jsx("input", { value: searchInput, onChange: (event) => setSearchInput(event.target.value), onKeyDown: (event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleSearch();
                                    }
                                }, placeholder: "Search username, email, company" }), _jsx("button", { className: "primary", type: "button", onClick: handleSearch, children: "Search" }), _jsx("button", { className: "ghost", type: "button", onClick: () => {
                                    void loadUsers();
                                    void loadActivity();
                                }, children: "Refresh" })] }), error ? _jsx("p", { className: "error", children: error }) : null, _jsxs("div", { className: "admin-grid", children: [_jsxs("aside", { className: "panel admin-panel", children: [_jsxs("h2", { children: ["Registered Users (", usersTotal.toLocaleString("en-US"), ")"] }), isLoadingUsers ? _jsx("p", { children: "Loading users..." }) : null, _jsx("div", { className: "admin-table-wrap", children: _jsxs("table", { className: "admin-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "User" }), _jsx("th", { children: "Contact" }), _jsx("th", { children: "Company" }), _jsx("th", { children: "Role" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Created" }), _jsx("th", { children: "Last Login" }), _jsx("th", { children: "Current Sessions" }), _jsx("th", { children: "Last Activity" })] }) }), _jsxs("tbody", { children: [users.map((entry) => (_jsxs("tr", { children: [_jsx("td", { children: entry.username }), _jsxs("td", { children: [_jsx("div", { children: entry.email }), _jsx("div", { children: entry.phoneNumber })] }), _jsx("td", { children: entry.companyName }), _jsx("td", { children: entry.role }), _jsx("td", { children: entry.isActive ? "active" : "inactive" }), _jsx("td", { children: formatDateTime(entry.createdAt) }), _jsx("td", { children: formatDateTime(entry.lastLoginAt) }), _jsx("td", { children: entry.activeSessionCount }), _jsx("td", { children: formatDateTime(entry.lastActivityAt) })] }, entry.id))), !isLoadingUsers && users.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 9, children: "No users found." }) })) : null] })] }) })] }), _jsxs("aside", { className: "panel admin-panel", children: [_jsxs("h2", { children: ["Activity Log (", eventsTotal.toLocaleString("en-US"), ")"] }), isLoadingEvents ? _jsx("p", { children: "Loading activity..." }) : null, _jsx("div", { className: "admin-table-wrap", children: _jsxs("table", { className: "admin-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "When" }), _jsx("th", { children: "User" }), _jsx("th", { children: "Event" }), _jsx("th", { children: "Metadata" })] }) }), _jsxs("tbody", { children: [events.map((event) => (_jsxs("tr", { children: [_jsx("td", { children: formatDateTime(event.createdAt) }), _jsx("td", { children: event.user?.username ?? "system" }), _jsx("td", { children: event.eventType }), _jsx("td", { children: _jsx("code", { children: formatMetadata(event.metadata) }) })] }, event.id))), !isLoadingEvents && events.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 4, children: "No activity events found." }) })) : null] })] }) })] })] }), isLoading ? _jsx("p", { children: "Refreshing admin data..." }) : null] })] }));
}
