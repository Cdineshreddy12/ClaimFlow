import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { signUp } from "./api";

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signUp(email, password);
      if (result.session) {
        // Email confirmation is off for this project — straight through.
        navigate("/onboarding/organization");
      } else {
        setNeedsConfirmation(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create your account.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (needsConfirmation) {
    return (
      <AuthLayout
        heading="Check your inbox"
        subheading={`We sent a confirmation link to ${email}.`}
      >
        <p className="empty-state">
          Click the link to confirm your email, then{" "}
          <Link to="/login" style={{ color: "var(--accent-ink)" }}>
            sign in
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      heading="Create your account"
      subheading="Set up your hospital's claims desk."
    >
      <form onSubmit={handleSubmit}>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="form-field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn--primary btn--full"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
