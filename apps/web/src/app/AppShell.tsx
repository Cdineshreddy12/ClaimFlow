import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { CustomModule } from "@claimflow/contracts";
import {
  Box,
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
  Menu,
  X,
} from "reicon-react";
import { signOut } from "../features/auth/api";
import { useAuth } from "../features/auth/AuthProvider";
import { SignOutIcon } from "../components/icons";
import { ROLE_LABEL } from "../lib/roles";
import { Button } from "../components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "../components/ui/drawer";
import { BrandMark, BrandName } from "@/components/ui/brand";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { useCustomModules } from "../features/custom/api";

/** Where this page was reached from, and what to call it. */
export interface BackTo {
  to: string;
  /**
   * The destination, named. Rendered as "Back to {label}", so it is a
   * place — "Claims", "Ward rounds", "the list" — and never the word
   * "Back" itself, which reads out as "Back to Back".
   */
  label: string;
}

interface AppShellProps {
  title: string;
  subtitle?: string;
  /**
   * Set by pages that sit under another one. A route reachable from
   * the nav has nowhere to go back to and leaves this off.
   */
  back?: BackTo;
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
  back,
  fill = false,
  children,
}: AppShellProps) {
  const navigate = useNavigate();
  const { session, role } = useAuth();
  // Live modules only — hiding one takes it out of the nav, which is
  // the only place it is reachable from.
  const { data: customModules } = useCustomModules();

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
      so there is one number to change and the two can't drift apart.
      Collapsed state is threaded through as a boolean rather than a
      parent class, because utilities have no cascade to hang
      `.is-collapsed .nav-item span` off.

      Under `lg` the rail is gone entirely and the nav lives in a sheet
      behind a button. It used to lay the same items out in a row
      across the top, which at ten destinations was 969px of nav on a
      390px screen: the page scrolled sideways on every route, the
      brand wrapped to two lines, and "Sign out" — in a block that was
      `hidden lg:flex` — was not reachable on a phone at all.
    */
    <div
      className={`flex min-h-screen flex-col lg:flex-row ${
        fill ? "lg:h-screen lg:overflow-hidden" : ""
      }`}
    >
      <MobileBar
        title={title}
        back={back}
        role={role}
        modules={customModules ?? []}
        email={session?.user.email}
        onSignOut={handleSignOut}
      />

      <aside
        className={`hidden lg:fixed lg:bottom-0 lg:left-0 lg:top-0 lg:z-20 lg:flex lg:flex-col lg:items-stretch lg:gap-7 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-sidebar-border lg:bg-sidebar lg:py-[22px] ${
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
        <NavList
          role={role}
          modules={customModules ?? []}
          collapsed={collapsed}
        />
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
          {/* The phone has this as a chevron in the bar. At `lg` the bar
              is gone, and the rail highlights the section rather than
              the page — so a claim opened from the list had nothing on
              screen pointing back to it. */}
          {back ? (
            <Link
              to={back.to}
              className="mb-3 hidden items-center gap-1 text-sm font-medium text-ink-soft no-underline hover:text-accent-ink lg:inline-flex"
            >
              <ChevronLeft size={13} aria-hidden />
              Back to {back.label}
            </Link>
          ) : null}
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
 * The phone header, and the nav behind it.
 *
 * Sticky, because the way back out of a long claims table should not
 * be a scroll to the top. It carries the page name too — the rail's
 * highlighted row said where you were at `lg`, and with the rail gone
 * nothing else does.
 *
 * The sheet comes from the right, on the same edge as the button that
 * opens it — a panel that flies in from the opposite side to the
 * control you just pressed reads as something else arriving. That edge
 * is also the reachable one on a phone held in either hand, which is
 * the half of the screen a thumb actually covers. It closes on
 * navigation: leaving it open over the page it just moved to would
 * mean two taps to see the result of one.
 *
 * The left slot carries the way back. On a detail page that is a
 * chevron to wherever this page was reached from; on a top-level one
 * there is nowhere to go back to, so it is the brand.
 */
function MobileBar({
  title,
  back,
  role,
  modules,
  email,
  onSignOut,
}: {
  title: string;
  back: BackTo | undefined;
  role: string | null;
  modules: CustomModule[];
  email: string | undefined;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-sidebar-border bg-sidebar px-4 py-2.5 lg:hidden">
      {back ? (
        <Link
          to={back.to}
          aria-label={`Back to ${back.label}`}
          className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent text-sidebar-ink no-underline hover:border-sidebar-border hover:bg-sidebar-hover"
        >
          <ChevronLeft size={18} aria-hidden />
        </Link>
      ) : (
        <BrandMark className="shrink-0 text-sidebar-ink" />
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-md font-semibold text-sidebar-ink">
          {title}
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <button
            type="button"
            className="-mr-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-sidebar-ink hover:border-sidebar-border hover:bg-sidebar-hover"
            aria-label="Open the menu"
          >
            <Menu size={18} aria-hidden />
          </button>
        </DrawerTrigger>

        <DrawerContent
          side="right"
          // Wide enough for "Checklist Admin" on one line, and short of
          // the full screen so the page behind stays visible as the
          // thing you are navigating within.
          widthClassName="w-[min(86vw,300px)]"
          className="border-sidebar-border bg-sidebar"
        >
          {/* Its own header rather than `DrawerHeader`, which paints
              its title in `text-ink` for the light panel — on the
              sidebar's navy that is dark on dark. Radix still gets a
              Title and Description, so the dialog keeps its name. */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-sidebar-border px-4 py-3">
            <div className="min-w-0">
              <DrawerTitle className="flex items-baseline gap-2 text-md font-semibold text-sidebar-ink">
                <BrandMark className="text-sidebar-ink" />
                <BrandName className="text-sidebar-ink" />
              </DrawerTitle>
              {email ? (
                <DrawerDescription className="mt-1 block truncate text-sm text-sidebar-soft">
                  {email}
                </DrawerDescription>
              ) : (
                <DrawerDescription className="sr-only">
                  Main navigation
                </DrawerDescription>
              )}
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                className="-mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-sidebar-soft hover:border-sidebar-border hover:text-sidebar-ink"
                aria-label="Close the menu"
              >
                <X size={16} aria-hidden />
              </button>
            </DrawerClose>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
            <NavList
              role={role}
              modules={modules}
              collapsed={false}
              className="flex flex-1 flex-col gap-0.5"
              onNavigate={() => setOpen(false)}
            />
          </div>

          <div className="shrink-0 border-t border-sidebar-border px-3.5 py-3">
            {role ? (
              <div className="mb-2 text-sm text-sidebar-faint">
                {ROLE_LABEL[role] ?? role}
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onSignOut}
            >
              Sign out
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * The nav destinations, once.
 *
 * Rendered twice — down the fixed rail at `lg` and up the mobile
 * sheet below it — and a second copy of this list is how one of them
 * quietly loses a module or a role gate.
 */
function NavList({
  role,
  modules,
  collapsed,
  className = "mt-1 flex flex-1 flex-col gap-0.5",
  onNavigate,
}: {
  role: string | null;
  modules: CustomModule[];
  collapsed: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className={className}>
      <NavItem
        to="/"
        end
        icon={<Grid3 />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        Dashboard
      </NavItem>
      <NavItem
        to="/claims"
        icon={<FileText />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        Claims
      </NavItem>
      <NavItem
        to="/queries"
        icon={<Envelope />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        Query Inbox
      </NavItem>
      {/* "SLA", matching the path and the clocks themselves. The label
          said "Turnaround", which is the thing the page *reports* —
          but the page is read for the hour that is running now, and a
          desk asks where the SLA screen is. */}
      <NavItem
        to="/sla"
        icon={<Clock />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        SLA
      </NavItem>
      {/* Finance rather than desk work, and gated server-side to
            the same roles — a desk executive following this link
            gets a refusal, so it is not offered to them. */}
      {role === "org_admin" || role === "desk_head" ? (
        <NavItem
          to="/receivables"
          icon={<Wallet />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        >
          Receivables
        </NavItem>
      ) : null}
      {/* Whatever this hospital invented, under its own name. The
            nav is the only place a custom module is discoverable, so
            a hidden one disappears from here and nowhere else. */}
      {modules.map((module) => (
        <NavItem
          key={module.id}
          to={`/m/${module.slug}`}
          icon={<Box />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        >
          {module.pluralName}
        </NavItem>
      ))}
      <NavItem
        to="/checklist"
        icon={<ShieldCheck />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        Checklist Admin
      </NavItem>
      {/* The one screen the API itself 403s a desk_executive out of
            — the report is a desk-head artifact for forwarding
            upstream, not a worklist (docs/adr/0018). */}
      {role === "org_admin" || role === "desk_head" ? (
        <NavItem
          to="/reports"
          icon={<File />}
          collapsed={collapsed}
          onNavigate={onNavigate}
        >
          Reports
        </NavItem>
      ) : null}
      <NavItem
        to="/settings/branding"
        icon={<Palette />}
        collapsed={collapsed}
        onNavigate={onNavigate}
      >
        Branding
      </NavItem>
    </nav>
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
  onNavigate,
  children,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  collapsed: boolean;
  /** Closes the mobile sheet — on the rail there is nothing to close. */
  onNavigate?: (() => void) | undefined;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      title={collapsed ? children : undefined}
      onClick={onNavigate}
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
