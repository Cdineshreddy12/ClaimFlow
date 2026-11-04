import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader } from "../../components/ui/loader";
import { AuthLayout } from "../auth/AuthLayout";
import { refreshSessionClaims } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { acceptInvite, previewInvite } from "./api";
import { ROLE_LABEL } from "../../lib/roles";

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { session, role } = useAuth();
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: preview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["invites", token, "preview"],
    queryFn: () => previewInvite(token),
    enabled: Boolean(token),
    retry: false,
  });

  async function handleAccept() {
    setError(null);
    setIsAccepting(true);
    try {
      await acceptInvite(token);
      await refreshSessionClaims();
      navigate("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't accept this invite.",
      );
      setIsAccepting(false);
    }
  }

  if (isLoading) {
    return (
      <AuthLayout heading="Checking your invite…">
        <Loader label="One moment." />
      </AuthLayout>
    );
  }

  if (isError || !preview) {
    return (
      <AuthLayout heading="Invite not found">
        <p className="empty-state">
          This invite link is invalid, expired, or has already been used. Ask
          whoever sent it for a new one.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      heading={`Join ${preview.hospitalName}`}
      subheading={`You've been invited as ${ROLE_LABEL[preview.role] ?? preview.role}.`}
    >
      {error ? <div className="inline-error">{error}</div> : null}

      {!session ? (
        <p className="empty-state">
          <Link to="/signup" style={{ color: "var(--accent-ink)" }}>
            Create an account
          </Link>{" "}
          or{" "}
          <Link to="/login" style={{ color: "var(--accent-ink)" }}>
            sign in
          </Link>{" "}
          first, then come back to this link to join.
        </p>
      ) : role ? (
        <p className="empty-state">
          You already have an account on this ClaimFlow. Invite links are for
          people joining for the first time.
        </p>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--full"
          disabled={isAccepting}
          onClick={handleAccept}
        >
          {isAccepting ? "Joining…" : `Join ${preview.hospitalName}`}
        </button>
      )}
    </AuthLayout>
  );
}
