import { supabase } from "../../lib/supabase-client";

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  // `session` is null when email confirmation is required — the caller
  // decides what to show based on that, not an error.
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Once hospital setup or invite-accept succeeds, a `members` row exists
 * for this user but the token in hand still doesn't know it — the Custom
 * Access Token hook only runs at mint/refresh time, never retroactively.
 * This forces a refresh so the next token actually carries the role.
 */
export async function refreshSessionClaims() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) throw error;
  return data.session;
}
