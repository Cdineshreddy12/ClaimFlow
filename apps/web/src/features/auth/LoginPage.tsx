import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { signIn } from "./api";
import { Button } from "../../components/ui/button";

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
    } catch {
      setError("Incorrect email or password.");
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
      <p className="mt-[18px] text-center text-base text-ink-soft [&_a]:font-semibold [&_a]:text-accent-ink [&_a]:no-underline">
        New hospital? <Link to="/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
