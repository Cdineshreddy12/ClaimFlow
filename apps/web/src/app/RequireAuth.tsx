import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../features/auth/AuthProvider";
import { Loader } from "../components/ui/loader";
import { useHospital } from "../features/hospital/api";

export function RequireAuth() {
  const { session, loading } = useAuth();

  if (loading) return <Loader fullPage />;
  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}

/**
 * Past RequireAuth a session exists, but it may carry no role — the user
 * signed up and has no `members` row yet. There's one hospital per
 * install, so they either claim it (first person in) or wait for an
 * invite; the setup screen handles both.
 */
export function RequireMembership() {
  const { role } = useAuth();
  if (!role) return <Navigate to="/onboarding/hospital" replace />;
  return <Outlet />;
}

/**
 * A hospital can exist with a half-finished profile — a desk can't
 * actually file a cashless claim without a ROHINI id and the rest, so
 * the app holds everyone in the wizard until it's done. Only an admin
 * can complete it, so anyone else gets told who to ask rather than being
 * bounced into a form they'd be 403'd on.
 */
export function RequireCompleteProfile() {
  const { role } = useAuth();
  const { data: hospital, isLoading } = useHospital();

  if (isLoading) return <Loader fullPage />;
  if (!hospital || hospital.onboardingCompletedAt) return <Outlet />;

  if (role !== "org_admin") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-heading">Setup isn&apos;t finished</h1>
          <p className="auth-subheading">
            {hospital.name} still needs its registration details added before
            claims can be filed. Ask your admin to finish setting up.
          </p>
        </div>
      </div>
    );
  }

  return <Navigate to="/onboarding/profile" replace />;
}
