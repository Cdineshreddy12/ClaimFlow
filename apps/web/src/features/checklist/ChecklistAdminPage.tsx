import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { Tabs } from "@/components/ui/tabs";
import { InsurersAdminCard } from "../insurers/InsurersAdminCard";
import { LayoutEditor } from "../preauth/LayoutEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { CoverageCard } from "./CoverageCard";
import { ProceduresAdminCard } from "./ProceduresAdminCard";
import { ProposalsCard } from "./ProposalsCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "../auth/AuthProvider";
import {
  useChecklistCoverage,
  useChecklistRules,
  useCreateRule,
  useDeleteRule,
  useInsurers,
  useProcedures,
  useUpdateRule,
} from "./api";
import { RuleRow } from "./RuleRow";

export function ChecklistAdminPage() {
  const { role } = useAuth();
  const canEdit = role === "org_admin" || role === "desk_head";

  const { data: insurers } = useInsurers();
  const { data: procedures } = useProcedures();
  const [tab, setTab] = useState("rules");
  const [insurerId, setInsurerId] = useState("");
  const [procedureId, setProcedureId] = useState("");

  /*
    Land on a pair that has rules.

    It used to take the first insurer and the first procedure, which
    are two independent alphabetical picks and almost never a pair
    anyone has configured — so the page opened on "No documents
    required yet for this pair" and read as though the whole feature
    were empty, with twenty rules one dropdown away.

    Coverage already knows which pairs are real; the busiest of them is
    the one an admin most likely came here for. Falling back to the
    first of each only when nothing is configured at all, which is the
    one time an empty screen is the truth.
  */
  const { data: coverage } = useChecklistCoverage();
  useEffect(() => {
    if (insurerId || procedureId) return;
    const busiest = [...(coverage?.covered ?? [])].sort(
      (a, b) => b.claims - a.claims || b.rules - a.rules,
    )[0];
    if (busiest) {
      setInsurerId(busiest.insurerId);
      setProcedureId(busiest.procedureId);
      return;
    }
    if (coverage && insurers?.length && procedures?.length) {
      setInsurerId(insurers[0]!.id);
      setProcedureId(procedures[0]!.id);
    }
  }, [coverage, insurers, procedures, insurerId, procedureId]);

  const { data, isLoading, isError } = useChecklistRules(
    insurerId,
    procedureId,
  );
  const createRule = useCreateRule(insurerId, procedureId);
  const updateRule = useUpdateRule(insurerId, procedureId);
  const deleteRule = useDeleteRule(insurerId, procedureId);

  const [newDocumentType, setNewDocumentType] = useState("");

  // On the tab itself, so the count of what this pair requires is
  // readable from the other two tabs without coming back.
  const ruleCount = data?.rules.length ? String(data.rules.length) : undefined;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = newDocumentType.trim();
    if (!value) return;
    createRule.mutate(value, { onSuccess: () => setNewDocumentType("") });
  }

  return (
    <AppShell
      title="Checklist Admin"
      subtitle="What each insurer requires, per procedure"
    >
      {/*
        Three tabs, one job each.

        These were merged into one on the argument that the insurer
        master and its rules are halves of the same job. They are — but
        stacked on a single tab the screen opened with two dropdowns, a
        seven-row editor, an add box and a five-column table all at
        once, and nothing said which of them you were meant to read
        first.

        The link between them survives the split: picking an insurer
        here carries to the other tabs, and the insurer list still
        drives the selection, so clicking a name and switching to Rules
        lands on that insurer's rules.
      */}
      <Tabs
        tabs={[
          {
            id: "rules",
            label: "Rules",
            ...(ruleCount
              ? { badge: ruleCount, badgeTone: "neutral" as const }
              : {}),
          },
          { id: "insurers", label: "Insurers & TPAs" },
          { id: "procedures", label: "Procedures" },
          { id: "preauth", label: "Pre-auth form" },
        ]}
        active={tab}
        onChange={setTab}
      >
        {tab === "preauth" ? (
          // The same insurer the other tabs are on, so one selection
          // drives everything an insurer wants.
          <LayoutEditor
            insurerId={insurerId || undefined}
            insurerName={
              insurers?.find((i) => i.id === insurerId)?.name ?? undefined
            }
          />
        ) : tab === "procedures" ? (
          <ProceduresAdminCard
            selectedId={procedureId}
            onSelect={(id) => {
              // Same move as the insurer list: picking one here is how
              // you get to its rules.
              setProcedureId(id);
              setTab("rules");
            }}
          />
        ) : tab === "insurers" ? (
          <InsurersAdminCard
            selectedId={insurerId}
            onSelect={(id) => {
              // Picking one here is how you get to its rules — the
              // reason these two ever shared a tab.
              setInsurerId(id);
              setTab("rules");
            }}
          />
        ) : (
          <RulesTab />
        )}
      </Tabs>
    </AppShell>
  );

  function RulesTab() {
    return (
      <>
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="min-w-[220px] flex-1">
            <div className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint mb-1.5">
              Insurer / TPA
            </div>
            <Select value={insurerId || undefined} onValueChange={setInsurerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an insurer…" />
              </SelectTrigger>
              <SelectContent>
                {insurers?.map((insurer) => (
                  <SelectItem key={insurer.id} value={insurer.id}>
                    {insurer.name} ·{" "}
                    {insurer.type === "tpa" ? "TPA" : "Insurer"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint mb-1.5">
              Procedure
            </div>
            <Select
              value={procedureId || undefined}
              onValueChange={setProcedureId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a procedure…" />
              </SelectTrigger>
              <SelectContent>
                {procedures?.map((procedure) => (
                  <SelectItem key={procedure.id} value={procedure.id}>
                    {procedure.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isError ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
            Couldn&apos;t load this checklist.
          </div>
        ) : null}

        {/* Above the rule editor, and outside the insurer/procedure
          filters: a proposal is about a pair the desk head may not have
          selected, and the whole point is to surface the pair they
          weren't looking at. */}
        <div className="mb-5">
          <ProposalsCard />
        </div>

        {/* Same reasoning as the proposals above: this is about pairs
            the desk head is not currently looking at, so it sits
            outside the two filters. */}
        <CoverageCard
          onPick={(insurer, procedure) => {
            setInsurerId(insurer);
            setProcedureId(procedure);
          }}
        />

        {/*
          One column, no cards. The rules list is the work; wrapping it
          in a card and standing a second card beside it to hold one
          number was chrome competing with the only thing on the page.
        */}
        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-2">
            <h2 className="m-0 text-md font-semibold text-ink">
              Required documents
            </h2>
            {/* The count, what it affects, and the forward-only rule in
                one sentence. They were a badge, a display numeral and a
                callout saying overlapping things. */}
            {data ? (
              <p className="m-0 text-sm text-ink-faint">
                {data.rules.length} document
                {data.rules.length === 1 ? "" : "s"} · {data.activeClaims}{" "}
                active claim{data.activeClaims === 1 ? "" : "s"} on this
                checklist · changes apply to claims opened from now on
              </p>
            ) : null}
          </div>

          {isLoading ? <Loader label="Loading rules…" /> : null}

          {data && data.rules.length === 0 ? (
            <p className="m-0 py-3 text-base text-ink-faint">
              No documents required yet for this pair.
            </p>
          ) : null}

          {data && data.rules.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {data.rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  canEdit={canEdit}
                  isBusy={updateRule.isPending || deleteRule.isPending}
                  onToggleRequired={(required) =>
                    updateRule.mutate({ id: rule.id, required })
                  }
                  onRemove={() => deleteRule.mutate(rule.id)}
                />
              ))}
            </div>
          ) : null}

          {canEdit && insurerId && procedureId ? (
            <form onSubmit={handleAdd} className="mt-3 flex gap-2">
              <Input
                aria-label="New document requirement"
                placeholder="Add a document requirement…"
                value={newDocumentType}
                onChange={(e) => setNewDocumentType(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!newDocumentType.trim() || createRule.isPending}
              >
                {createRule.isPending ? "Adding…" : "Add"}
              </Button>
            </form>
          ) : null}

          {!canEdit ? (
            <p className="m-0 mt-3 text-sm text-ink-faint">
              You can view these rules but not change them — ask a desk head or
              an admin.
            </p>
          ) : null}

          {createRule.isError ? (
            <div className="mt-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
              {createRule.error instanceof Error
                ? createRule.error.message
                : "Couldn't add that requirement."}
            </div>
          ) : null}
        </section>
      </>
    );
  }
}
