import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import type { InboxQuery } from "./types";

export function useQueryInbox(status: "open" | "replied" | "all" = "open") {
  return useQuery({
    queryKey: ["queries", "inbox", status],
    queryFn: () => api.get<InboxQuery[]>(`/queries?status=${status}`),
  });
}

/**
 * The confirm step on a summarised reply deadline — docs/adr/0005.
 *
 * No `deadline` in the body confirms the stored date as it stands; a
 * date overrides it; `null` clears one the email never really set.
 * Sending nothing rather than echoing the value back means a confirm
 * can't quietly rewrite a deadline that changed since this inbox was
 * fetched.
 */
export function useConfirmDeadline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deadline }: { id: string; deadline?: string | null }) =>
      api.patch<InboxQuery>(
        `/queries/${id}/deadline`,
        deadline === undefined ? {} : { deadline },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queries", "inbox"] });
    },
  });
}

/**
 * Records that a reply went out through whatever channel (email/portal) —
 * nothing is sent from here. No reply body is stored either, since the
 * schema only tracks the timestamp — see docs/adr/0005.
 */
export function useMarkReplied() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<InboxQuery>(`/queries/${id}/reply`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queries", "inbox"] });
    },
  });
}
