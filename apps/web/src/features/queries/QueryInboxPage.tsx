import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../app/AppShell";
import { QueryCard } from "./QueryCard";
import { QueryDetailPanel } from "./QueryDetailPanel";
import { useQueryInbox } from "./api";

export function QueryInboxPage() {
  const { data: queries, isLoading, isError } = useQueryInbox("open");
  const now = useMemo(() => Date.now(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!queries || queries.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!queries.some((q) => q.id === selectedId)) {
      setSelectedId(queries[0]!.id);
    }
  }, [queries, selectedId]);

  const selected = queries?.find((q) => q.id === selectedId);

  return (
    <AppShell title="Query Inbox" subtitle="Open TPA queries across the desk">
      {isLoading ? <p className="empty-state">Loading…</p> : null}
      {isError ? (
        <div className="inline-error">Couldn't load the query inbox.</div>
      ) : null}

      {!isLoading && !isError && queries?.length === 0 ? (
        <p className="empty-state">No open queries — the inbox is clear.</p>
      ) : null}

      {queries && queries.length > 0 ? (
        <div className="query-shell">
          <div className="query-list">
            {queries.map((query) => (
              <QueryCard
                key={query.id}
                query={query}
                selected={query.id === selectedId}
                now={now}
                onSelect={() => setSelectedId(query.id)}
              />
            ))}
          </div>
          {selected ? <QueryDetailPanel query={selected} now={now} /> : null}
        </div>
      ) : null}
    </AppShell>
  );
}
