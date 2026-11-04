import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Shared chrome ported from docs/design/claims-desk-mockup.html. The nav
 * only lists routes that actually exist yet — Dashboard, Query Inbox, and
 * Checklist Admin land here once their screens are built, not before.
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
