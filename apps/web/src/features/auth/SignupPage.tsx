import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { signUp } from "./api";
import { Button } from "../../components/ui/button";

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
        // There's no "create your hospital" step to land on any more
        // (see RequireMembership): a fresh signup with no invite lands
        // on "ask your admin for an invite" at the root, same as anyone
        // else without a membership.
        navigate("/");
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
        <p className="px-1 py-2.5 text-base text-ink-faint">
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
        {error ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            {error}
          </div>
        ) : null}
        <div className="mb-4 flex flex-col gap-1.5 [&_input]:rounded-md [&_input]:border [&_input]:border-line-strong [&_input]:bg-surface-raised [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-md [&_input]:text-ink [&_input[aria-invalid=true]]:border-critical [&_label]:text-sm [&_label]:font-semibold [&_label]:text-ink-soft">
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
        <div className="mb-4 flex flex-col gap-1.5 [&_input]:rounded-md [&_input]:border [&_input]:border-line-strong [&_input]:bg-surface-raised [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-md [&_input]:text-ink [&_input[aria-invalid=true]]:border-critical [&_label]:text-sm [&_label]:font-semibold [&_label]:text-ink-soft">
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
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-[18px] text-center text-base text-ink-soft [&_a]:font-semibold [&_a]:text-accent-ink [&_a]:no-underline">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
