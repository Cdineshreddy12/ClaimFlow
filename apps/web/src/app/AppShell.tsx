import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Clock,
  Envelope,
  Grid3,
  ShieldCheck,
  FileText,
  File,
  Palette,
  Wallet,
  ChevronLeft,
  ChevronRight,
} from "reicon-react";
import { signOut } from "../features/auth/api";
import { useAuth } from "../features/auth/AuthProvider";
import { SignOutIcon } from "../components/icons";
import { ROLE_LABEL } from "../lib/roles";
import { Button } from "../components/ui/button";
import { BrandMark, BrandName } from "@/components/ui/brand";
import { AssistantPanel } from "../features/assistant/AssistantPanel";

interface AppShellProps {
  title: string;
  subtitle?: string;
  /**
   * For screens that are a workspace rather than a document — the query
   * inbox's two panes each scroll themselves, so the page must not also
   * scroll behind them.
   */
  fill?: boolean;
  children: ReactNode;
}

/**
 * Shared chrome ported from docs/design/claims-desk-mockup.html. The nav
 * lists only routes that exist.
 */
const COLLAPSED_KEY = "claimflow.sidebar.collapsed";

export function AppShell({
  title,
  subtitle,
  fill = false,
  children,
}: AppShellProps) {
  const navigate = useNavigate();
  const { session, role } = useAuth();

  // Remembered across navigations and reloads — a desk that collapsed
  // the nav to see a wide claims table doesn't want it back every time
  // they open a claim.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // The page name has to live somewhere now the bar is gone — the tab
  // is where a desk with six tabs open actually looks for it.
  useEffect(() => {
    document.title = `${title} · ClaimFlow`;
  }, [title]);

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    /*
      The rail is fixed and the main column is pushed by the same width,
      so there is one number to change and the two can't drift apart. It
      becomes a horizontal bar under `lg`. Collapsed state is threaded
      through as a boolean rather than a parent class, because utilities
      have no cascade to hang `.is-collapsed .nav-item span` off.
    */
    <div
      className={`flex min-h-screen flex-col lg:flex-row ${
        fill ? "lg:h-screen lg:overflow-hidden" : ""
      }`}
    >
      <aside
        className={`static z-20 flex w-full flex-row items-center gap-4 overflow-visible border-b border-sidebar-border bg-sidebar px-4 py-3 lg:fixed lg:bottom-0 lg:left-0 lg:top-0 lg:flex-col lg:items-stretch lg:gap-7 lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-r lg:py-[22px] ${
          collapsed ? "lg:w-16 lg:px-2.5" : "lg:w-[228px] lg:px-3.5"
        }`}
      >
        <button
          type="button"
          className={`hidden size-[22px] cursor-pointer items-center justify-center rounded-sm border border-sidebar-border bg-white/[0.04] p-0 text-2xs leading-none text-sidebar-faint hover:border-white/[0.16] hover:text-sidebar-ink lg:flex ${
            collapsed
              ? "lg:mx-auto lg:static"
              : "lg:absolute lg:right-2.5 lg:top-6"
          }`}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
        <div
          className={`flex flex-col gap-[3px] ${collapsed ? "lg:gap-2.5" : ""}`}
        >
          <div
            className={`flex items-baseline gap-2 px-2.5 ${
              collapsed ? "lg:justify-center lg:p-0" : ""
            }`}
          >
            <BrandMark className="text-sidebar-ink" />
            {collapsed ? null : <BrandName className="text-sidebar-ink" />}
          </div>
        </div>
        <nav className="mt-1 flex flex-1 flex-row gap-0.5 lg:flex-col">
          <NavItem to="/" end icon={<Grid3 />} collapsed={collapsed}>
            Dashboard
          </NavItem>
          <NavItem to="/claims" icon={<FileText />} collapsed={collapsed}>
            Claims
          </NavItem>
          <NavItem to="/queries" icon={<Envelope />} collapsed={collapsed}>
            Query Inbox
          </NavItem>
          <NavItem to="/sla" icon={<Clock />} collapsed={collapsed}>
            Turnaround
          </NavItem>
          {/* Finance rather than desk work, and gated server-side to
              the same roles — a desk executive following this link
              gets a refusal, so it is not offered to them. */}
          {role === "org_admin" || role === "desk_head" ? (
            <NavItem to="/receivables" icon={<Wallet />} collapsed={collapsed}>
              Receivables
            </NavItem>
          ) : null}
          <NavItem to="/checklist" icon={<ShieldCheck />} collapsed={collapsed}>
            Checklist Admin
          </NavItem>
          {/* The one screen the API itself 403s a desk_executive out of
              — the report is a desk-head artifact for forwarding
              upstream, not a worklist (docs/adr/0018). */}
          {role === "org_admin" || role === "desk_head" ? (
            <NavItem to="/reports" icon={<File />} collapsed={collapsed}>
              Reports
            </NavItem>
          ) : null}
          <NavItem
            to="/settings/branding"
            icon={<Palette />}
            collapsed={collapsed}
          >
            Branding
          </NavItem>
        </nav>
        <div
          className={`mt-auto hidden flex-col gap-2.5 lg:flex ${collapsed ? "items-center p-0" : "px-2.5"}`}
        >
          {/* An address wraps to six lines in a 64px rail. Collapsed
              trades it for the sign-out button's tooltip, which carries
              the same address. */}
          {collapsed ? null : (
            <div className="text-sm leading-snug text-sidebar-faint [overflow-wrap:anywhere] [&_strong]:text-sidebar-ink">
              Signed in as <strong>{session?.user.email}</strong>
              {/* Which role, because half this nav is gated on it — a
                  desk executive wondering where Reports went is owed
                  the reason. */}
              {role ? (
                <span className="mt-0.5 block">{ROLE_LABEL[role] ?? role}</span>
              ) : null}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size={collapsed ? "icon" : "sm"}
            className="w-full"
            onClick={handleSignOut}
            title={
              collapsed
                ? `Sign out of ${session?.user.email ?? "this account"}`
                : "Sign out"
            }
          >
            {collapsed ? <SignOutIcon /> : "Sign out"}
          </Button>
        </div>
      </aside>

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          collapsed ? "lg:ml-16" : "lg:ml-[228px]"
        }`}
      >
        {/* No visible page header: the nav already says where you are,
            and the bar was a strip of chrome on every screen carrying a
            word the sidebar had highlighted anyway. The heading stays in
            the document for screen readers and the browser tab, just
            not on the canvas. */}
        <h1 className="sr-only">
          {subtitle ? `${title} — ${subtitle}` : title}
        </h1>
        <main
          className={`w-full px-4 pb-20 pt-5 lg:px-8 lg:pb-[76px] lg:pt-7 ${
            fill
              ? "flex min-h-0 flex-1 flex-col lg:overflow-hidden lg:pb-7"
              : ""
          }`}
        >
          {children}
        </main>
      </div>

      {/* Every screen, because the work it does interrupts whatever you
          were already doing — a scan arrives mid-claim. */}
      <AssistantPanel />
    </div>
  );
}

/**
 * One nav row. Collapsed hides the label and centres the icon — the
 * old rule did this with `.is-collapsed .nav-item span { display:none }`,
 * which utilities can't express, so the label is simply not rendered.
 */
/**
 * One nav destination.
 *
 * Collapsing is this component's business because it is more than a
 * width: the label has to go, or "Checklist Admin" wraps to three lines
 * inside a 64px rail, and the icon left standing on its own needs a
 * tooltip to stay identifiable. The label stays in the DOM either way,
 * so the link keeps its accessible name.
 *
 * Every collapsed rule is `lg:`-scoped. Under `lg` the rail is a
 * horizontal bar across the top where labels fit and belong, and
 * `collapsed` is remembered from whenever the window was last wide.
 */
function NavItem({
  to,
  end,
  icon,
  collapsed,
  children,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  collapsed: boolean;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      title={collapsed ? children : undefined}
      className={({ isActive }) => navItem(isActive, collapsed)}
    >
      {icon}
      <span className={collapsed ? "lg:hidden" : undefined}>{children}</span>
    </NavLink>
  );
}

function navItem(isActive: boolean, collapsed: boolean): string {
  return [
    "flex items-center gap-2.5 rounded-sm px-2.5 py-[9px] text-md font-medium no-underline transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
    collapsed ? "lg:justify-center lg:px-0" : "",
    isActive
      ? "bg-sidebar-active text-white shadow-[inset_0_0_0_1px_var(--sidebar-active-ring)] [&_svg]:text-sidebar-ring [&_svg]:opacity-100"
      : "text-sidebar-soft hover:bg-sidebar-hover hover:text-sidebar-ink [&_svg]:opacity-80",
  ].join(" ");
}
