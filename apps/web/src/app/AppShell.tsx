import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "../features/auth/api";
import { useAuth } from "../features/auth/AuthProvider";
import { useCurrentOrganization } from "../features/organizations/api";
import { ROLE_LABEL } from "../lib/roles";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Shared chrome ported from docs/design/claims-desk-mockup.html. The nav
 * only lists routes that actually exist yet — Checklist Admin lands here
 * once that screen is built, not before.
 */
export function AppShell({ title, subtitle, children }: AppShellProps) {
  const navigate = useNavigate();
  const { session, role } = useAuth();
  const { data: organization } = useCurrentOrganization();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">Claims Desk</span>
          </div>
          <div className="brand-sub">{organization?.name ?? "—"}</div>
        </div>
        <nav className="nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <svg viewBox="0 0 16 16" fill="none">
              <rect
                x="1.5"
                y="1.5"
                width="6"
                height="6"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="8.5"
                y="1.5"
                width="6"
                height="9"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="1.5"
                y="9.5"
                width="6"
                height="5"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            Dashboard
          </NavLink>
          <NavLink
            to="/queries"
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M2.5 4.5 8 9l5.5-4.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
            Query Inbox
          </NavLink>
          <NavLink
            to="/checklist"
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5 3 3.8v3.9c0 3.4 2.2 5.6 5 6.8 2.8-1.2 5-3.4 5-6.8V3.8L8 1.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M6 8.2l1.5 1.5L10.2 6.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Checklist Admin
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            Signed in as{" "}
            <strong style={{ color: "var(--ink)" }}>
              {session?.user.email}
            </strong>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{title}</div>
            {subtitle ? <div className="topbar-sub">{subtitle}</div> : null}
          </div>
          <div className="topbar-user">
            <strong>{session?.user.email}</strong>
            <br />
            {role ? (ROLE_LABEL[role] ?? role) : null}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
