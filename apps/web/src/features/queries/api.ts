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
