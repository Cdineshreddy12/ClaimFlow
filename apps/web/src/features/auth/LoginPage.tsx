import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { signIn } from "./api";

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
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="form-field">
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
        <div className="form-field">
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
        <button
          type="submit"
          className="btn btn--primary btn--full"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        New hospital? <Link to="/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
