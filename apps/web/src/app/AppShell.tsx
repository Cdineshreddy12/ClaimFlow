import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

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
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">Claims Desk</span>
          </div>
          <div className="brand-sub">Company A — Nashik</div>
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
        </nav>
        <div className="sidebar-foot">
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            Signed in as{" "}
            <strong style={{ color: "var(--ink)" }}>Desk Head</strong>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{title}</div>
            {subtitle ? <div className="topbar-sub">{subtitle}</div> : null}
          </div>
          <div className="topbar-user">
            <strong>Priya Nair</strong>
            <br />
            Insurance Desk
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
