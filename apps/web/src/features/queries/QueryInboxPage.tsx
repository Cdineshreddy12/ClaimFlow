import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../app/AppShell";
import { Loader } from "../../components/ui/loader";
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
  // Only take over the viewport once there are two panes to fill it;
  // a loader or an empty state reads better in the ordinary page flow.
  const hasQueries = Boolean(queries && queries.length > 0);

  return (
    <AppShell
      title="Query Inbox"
      subtitle="Open TPA queries across the desk"
      fill={hasQueries}
    >
      {isLoading ? <Loader label="Loading queries…" /> : null}
      {isError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
          Couldn't load the query inbox.
        </div>
      ) : null}

      {!isLoading && !isError && queries?.length === 0 ? (
        <p className="px-1 py-2.5 text-base text-ink-faint">
          No open queries — the inbox is clear.
        </p>
      ) : null}

      {queries && queries.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-line bg-surface-raised lg:grid-cols-[320px_1fr] [&>*]:min-w-0">
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain flex max-h-[40vh] flex-col border-b border-line lg:max-h-none lg:border-b-0 lg:border-r">
            <div className="z-[1] border-b border-line bg-surface-raised px-3.5 pb-2.5 pt-3.5 lg:sticky lg:top-0">
              <span className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
                {queries.length} open{" "}
                {queries.length === 1 ? "query" : "queries"}
              </span>
            </div>
            <div className="flex flex-col">
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
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-[22px] py-5">
            {selected ? (
              <QueryDetailPanel query={selected} now={now} />
            ) : (
              <p className="px-1 py-2.5 text-base text-ink-faint">
                Pick a query to read it.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
