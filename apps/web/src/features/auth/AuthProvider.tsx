import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../../lib/supabase-client";
import { useMe } from "./me";

/** Empty in any production build — injected by vite.config.ts, see the note there. */
const DEV_TOKEN =
  (typeof __DEV_TOKEN__ === "string" ? __DEV_TOKEN__ : "") || undefined;

interface AuthState {
  session: Session | null;
  /** Resolved once the initial session check completes — distinct from "logged out", which is session === null after loading finishes. */
  loading: boolean;
  /**
   * The desk role from the token's app_metadata, stamped by the Custom
   * Access Token hook. Null means the signed-in user has no `members`
   * row yet, which is what routes them into onboarding.
   */
  role: string | null;
  /** True when running on the local dev-token bridge rather than a real Supabase session. */
  isDevSession: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Reads the dev token's claims without verifying it — the API verifies
 * for real (apps/api/src/lib/supabase-jwt.ts); this only needs to know
 * what to render. Returns a shape that satisfies the parts of Session
 * the app actually reads.
 */
function decodeDevSession(token: string): Session | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!));
    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 0,
      refresh_token: "",
      user: {
        id: payload.sub,
        email: payload.email ?? "dev session (no sign-in)",
        app_metadata: payload.app_metadata ?? {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "",
      },
    } as Session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() =>
    DEV_TOKEN ? decodeDevSession(DEV_TOKEN) : null,
  );
  const [loading, setLoading] = useState(!DEV_TOKEN);

  useEffect(() => {
    // On the dev bridge there's no Supabase session to track — the token
    // in .env is the whole story, and subscribing would immediately
    // overwrite it with null.
    if (DEV_TOKEN) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      },
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  const claimedRole =
    (session?.user.app_metadata.role as string | undefined) ?? null;

  /**
   * The claim is the fast path, not the only one.
   *
   * `app_metadata.role` is stamped when a token is minted, so a session
   * predating a membership — or an install where the Custom Access
   * Token hook was never enabled — carries no role at all. The app was
   * already coping with that at the door: RequireMembership asks /me
   * and lets you in. It just threw the answer away, so every
   * role-gated control in the app then read the empty claim and hid
   * itself from people who were, in fact, admins.
   *
   * Only fetched when the claim missed, so a normal session still
   * costs nothing.
   */
  const { data: me } = useMe(Boolean(session) && !claimedRole);
  const role = claimedRole ?? me?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        role,
        isDevSession: Boolean(DEV_TOKEN),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
