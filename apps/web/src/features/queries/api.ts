import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import type { InboxQuery } from "./types";

export function useQueryInbox(status: "open" | "replied" | "all" = "open") {
  return useQuery({
    queryKey: ["queries", "inbox", status],
    queryFn: () => api.get<InboxQuery[]>(`/queries?status=${status}`),
  });
}
