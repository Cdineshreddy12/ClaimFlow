import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthLayout } from "../auth/AuthLayout";
import { refreshSessionClaims } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { createOrganization } from "./api";

export function CreateOrganizationPage() {
  const navigate = useNavigate();
  const { organizationId } = useAuth();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already onboarded (e.g. revisited this URL directly) — nothing to do here.
  if (organizationId) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await createOrganization(name);
      // The token in hand still doesn't carry org/role — the Custom Access
      // Token hook only runs at mint/refresh time, not retroactively.
      await refreshSessionClaims();
      navigate("/onboarding/profile");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't create your organization.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      heading="Set up your hospital"
      subheading="This becomes your organization's name across ClaimFlow."
    >
      <form onSubmit={handleSubmit}>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="form-field">
          <label htmlFor="name">Hospital name</label>
          <input
            id="name"
            type="text"
            required
            placeholder="e.g. City General Hospital"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--full"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Setting up…" : "Continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
