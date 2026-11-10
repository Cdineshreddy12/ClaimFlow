import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { signIn } from "./api";
import { Button } from "../../components/ui/button";

/**
 * What actually went wrong, rather than the commonest guess.
 *
 * Blaming the credentials for a rate limit or a failed request sends
 * someone to retype a password that was correct, and sign-in is the
 * one screen with no other way to find out. Supabase distinguishes
 * these on the error it throws.
 */
function signInProblem(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const status = (error as { status?: number } | null)?.status;

  if (code === "invalid_credentials") return "Incorrect email or password.";
  if (code === "email_not_confirmed") {
    return "That address hasn't been confirmed yet — check the sign-up email.";
  }
  if (status === 429 || code === "over_request_rate_limit") {
    return "Too many sign-in attempts. Wait a minute, then try again.";
  }
  // No status at all means the request never reached Supabase: offline,
  // DNS, a blocked request. Retyping the password cannot help.
  if (status === undefined) {
    return "Couldn't reach the sign-in service. Check your connection and try again.";
  }
  return "Couldn't sign you in. Please try again.";
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email, password);
      navigate("/");
    } catch (err) {
      setError(signInProblem(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      heading="Sign in"
      subheading="Welcome back to your claims desk."
    >
      <form onSubmit={handleSubmit}>
        {error ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            {error}
          </div>
        ) : null}
        <div className="mb-4 flex flex-col gap-1.5 [&_input]:rounded-md [&_input]:border [&_input]:border-line-strong [&_input]:bg-surface-raised [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-md [&_input]:text-ink [&_input[aria-invalid=true]]:border-critical [&_label]:text-sm [&_label]:font-semibold [&_label]:text-ink-soft">
          <label htmlFor="email">Email</label>
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {/* No "create an account" here. One install serves one hospital,
          and that hospital exists by the time anyone sees this screen —
          so the only people who should be signing in are ones an
          org_admin invited. Offering self-registration on the way in
          invites exactly the person who was not invited. The /signup
          route still exists for the first admin of a fresh install and
          for accepting an invite, which is where it is linked from. */}
    </AuthLayout>
  );
}
