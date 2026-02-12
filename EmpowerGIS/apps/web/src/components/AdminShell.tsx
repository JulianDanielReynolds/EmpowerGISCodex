import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAdminActivity,
  getAdminUsers,
  type AdminActivityEvent,
  type AdminUserSummary,
  type AuthUser,
  type SessionTokens
} from "../lib/api";

interface AdminShellProps {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  onSessionTokensUpdated: (tokens: SessionTokens) => void;
  onLogout: () => void;
  onBackToMap: () => void;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatMetadata(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return JSON.stringify(value);
}

export default function AdminShell({
  user,
  accessToken,
  refreshToken,
  onSessionTokensUpdated,
  onLogout,
  onBackToMap
}: AdminShellProps) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [events, setEvents] = useState<AdminActivityEvent[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authRequestOptions = useMemo(
    () => ({
      refreshToken,
      onSessionTokensUpdated
    }),
    [refreshToken, onSessionTokensUpdated]
  );

  const loadUsers = useCallback(async () => {
    if (!accessToken || user?.role !== "admin") return;
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load users");
    } finally {
      setIsLoadingUsers(false);
    }
  }, [accessToken, authRequestOptions, searchFilter, user?.role]);

  const loadActivity = useCallback(async () => {
    if (!accessToken || user?.role !== "admin") return;
    setIsLoadingEvents(true);
    setError(null);
    try {
      const response = await getAdminActivity(accessToken, {
        ...authRequestOptions,
        limit: 250
      });
      setEvents(response.events);
      setEventsTotal(response.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load activity logs");
    } finally {
      setIsLoadingEvents(false);
    }
  }, [accessToken, authRequestOptions, user?.role]);

  useEffect(() => {
    if (!accessToken || user?.role !== "admin") return;
    void loadUsers();
    void loadActivity();
  }, [accessToken, user?.role, loadUsers, loadActivity]);

  const handleSearch = () => {
    setSearchFilter(searchInput.trim());
  };

  useEffect(() => {
    if (!accessToken || user?.role !== "admin") return;
    void loadUsers();
  }, [searchFilter, accessToken, user?.role, loadUsers]);

  if (!accessToken) {
    return (
      <main className="app-layout">
        <header className="top-bar">
          <div>
            <h1>EmpowerGIS Admin</h1>
            <p>Sign in to view registered users and activity.</p>
          </div>
          <div className="top-bar-right">
            <button className="ghost" onClick={onBackToMap}>
              Back to Map
            </button>
          </div>
        </header>
      </main>
    );
  }

  if (user?.role !== "admin") {
    return (
      <main className="app-layout">
        <header className="top-bar">
          <div>
            <h1>EmpowerGIS Admin</h1>
            <p>Admin access is required.</p>
          </div>
          <div className="top-bar-right">
            <span>{user?.username ?? "Unknown user"}</span>
            <button className="ghost" onClick={onBackToMap}>
              Back to Map
            </button>
            <button className="ghost" onClick={onLogout}>
              Logout
            </button>
          </div>
        </header>
        <section className="admin-content">
          <aside className="panel">
            <p className="error">
              Your account is not an admin. Ask an existing admin to grant your account admin access.
            </p>
          </aside>
        </section>
      </main>
    );
  }

  const isLoading = isLoadingUsers || isLoadingEvents;

  return (
    <main className="app-layout">
      <header className="top-bar">
        <div>
          <h1>EmpowerGIS Admin</h1>
          <p>User registrations and activity monitoring</p>
        </div>
        <div className="top-bar-right">
          <span>{user.username}</span>
          <button className="ghost" onClick={onBackToMap}>
            Back to Map
          </button>
          <button className="ghost" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="admin-content">
        <div className="admin-toolbar">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Search username, email, company"
          />
          <button className="primary" type="button" onClick={handleSearch}>
            Search
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              void loadUsers();
              void loadActivity();
            }}
          >
            Refresh
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="admin-grid">
          <aside className="panel admin-panel">
            <h2>Registered Users ({usersTotal.toLocaleString("en-US")})</h2>
            {isLoadingUsers ? <p>Loading users...</p> : null}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Contact</th>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last Login</th>
                    <th>Current Sessions</th>
                    <th>Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.username}</td>
                      <td>
                        <div>{entry.email}</div>
                        <div>{entry.phoneNumber}</div>
                      </td>
                      <td>{entry.companyName}</td>
                      <td>{entry.role}</td>
                      <td>{entry.isActive ? "active" : "inactive"}</td>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>{formatDateTime(entry.lastLoginAt)}</td>
                      <td>{entry.activeSessionCount}</td>
                      <td>{formatDateTime(entry.lastActivityAt)}</td>
                    </tr>
                  ))}
                  {!isLoadingUsers && users.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No users found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </aside>

          <aside className="panel admin-panel">
            <h2>Activity Log ({eventsTotal.toLocaleString("en-US")})</h2>
            {isLoadingEvents ? <p>Loading activity...</p> : null}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Event</th>
                    <th>Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDateTime(event.createdAt)}</td>
                      <td>{event.user?.username ?? "system"}</td>
                      <td>{event.eventType}</td>
                      <td>
                        <code>{formatMetadata(event.metadata)}</code>
                      </td>
                    </tr>
                  ))}
                  {!isLoadingEvents && events.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No activity events found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </aside>
        </div>

        {isLoading ? <p>Refreshing admin data...</p> : null}
      </section>
    </main>
  );
}
