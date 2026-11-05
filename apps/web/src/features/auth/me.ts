import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";

export interface Me {
  userId: string;
  role: string | null;
  memberId: string | null;
  hospitalName: string | null;
  /** False only on a brand-new install nobody has claimed yet. */
  hospitalExists: boolean;
}

/**
 * Who the server says you are.
 *
 * The JWT's role claim is the fast path, but it's only written when a
 * token is minted — a membership created afterwards leaves it missing
 * while the row exists. Rather than guess from a stale token, ask.
 *
 * Not retried: a 401 here means the session is genuinely bad, and
 * hammering the endpoint won't change that.
 */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/me"),
    enabled,
    retry: false,
    staleTime: 30 * 1000,
  });
}
