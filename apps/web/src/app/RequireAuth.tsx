import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { useCurrentOrganization } from "../features/organizations/api";

function FullPageLoading() {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <p className="empty-state">Loading…</p>
    </div>
  );
}

export function RequireAuth() {
  const { session, loading } = useAuth();

  if (loading) return <FullPageLoading />;
  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}

/** Past RequireAuth, a session exists but may not carry org/role yet (just signed up, or the invite flow isn't done). */
export function RequireOrg() {
  const { organizationId } = useAuth();
  if (!organizationId)
    return <Navigate to="/onboarding/organization" replace />;
  return <Outlet />;
}

/**
 * An org can exist with a half-finished hospital profile — a desk can't
 * actually file a cashless claim without a ROHINI id and the rest, so
 * the app holds everyone in the wizard until it's done. Only org_admin
 * can complete it, so anyone else gets told who to ask rather than being
 * bounced into a form they'd be 403'd on.
 */
export function RequireCompleteProfile() {
  const { role } = useAuth();
  const { data: organization, isLoading } = useCurrentOrganization();

  if (isLoading) return <FullPageLoading />;
  if (!organization || organization.onboardingCompletedAt) return <Outlet />;

  if (role !== "org_admin") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-heading">Setup isn't finished</h1>
          <p className="auth-subheading">
            {organization.name} still needs its registration details added
            before claims can be filed. Ask your admin to finish setting up.
          </p>
        </div>
      </div>
    );
  }

  return <Navigate to="/onboarding/profile" replace />;
}
