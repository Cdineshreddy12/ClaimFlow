import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "../auth/AuthProvider";
import {
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
  const [insurerId, setInsurerId] = useState("");
  const [procedureId, setProcedureId] = useState("");

  // Land on a real pair rather than an empty screen — the admin almost
  // always wants to see *a* checklist, not choose from nothing.
  useEffect(() => {
    if (!insurerId && insurers?.length) setInsurerId(insurers[0]!.id);
  }, [insurers, insurerId]);
  useEffect(() => {
    if (!procedureId && procedures?.length) setProcedureId(procedures[0]!.id);
  }, [procedures, procedureId]);

  const { data, isLoading, isError } = useChecklistRules(
    insurerId,
    procedureId,
  );
  const createRule = useCreateRule(insurerId, procedureId);
  const updateRule = useUpdateRule(insurerId, procedureId);
  const deleteRule = useDeleteRule(insurerId, procedureId);

  const [newDocumentType, setNewDocumentType] = useState("");

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
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="label-eyebrow mb-1.5">Insurer / TPA</div>
          <Select value={insurerId || undefined} onValueChange={setInsurerId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an insurer…" />
            </SelectTrigger>
            <SelectContent>
              {insurers?.map((insurer) => (
                <SelectItem key={insurer.id} value={insurer.id}>
                  {insurer.name} · {insurer.type === "tpa" ? "TPA" : "Insurer"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="label-eyebrow mb-1.5">Procedure</div>
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
        <div className="inline-error">Couldn&apos;t load this checklist.</div>
      ) : null}

      <div className="two-col two-col--dashboard">
        <div className="card card-pad" style={{ order: 1 }}>
          <div className="card-head">
            <h2 className="label-eyebrow">Required documents</h2>
            {data ? (
              <span className="chip chip--neutral">
                {data.rules.length} rules
              </span>
            ) : null}
          </div>

          {isLoading ? <Loader label="Loading rules…" /> : null}

          {data && data.rules.length === 0 ? (
            <p className="empty-state">
              No documents required yet for this pair. Add the first one below.
            </p>
          ) : null}

          {data && data.rules.length > 0 ? (
            <div className="checklist">
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
            <form
              onSubmit={handleAdd}
              className="mt-3 flex gap-2 border-t border-dashed border-line-strong pt-3"
            >
              <Input
                aria-label="New document requirement"
                placeholder="Add a document requirement…"
                value={newDocumentType}
                onChange={(e) => setNewDocumentType(e.target.value)}
              />
              <Button
                type="submit"
                variant="ghost"
                disabled={!newDocumentType.trim() || createRule.isPending}
              >
                {createRule.isPending ? "Adding…" : "Add"}
              </Button>
            </form>
          ) : null}

          {createRule.isError ? (
            <div className="inline-error mt-3">
              {createRule.error instanceof Error
                ? createRule.error.message
                : "Couldn't add that requirement."}
            </div>
          ) : null}
        </div>

        <div className="card card-pad" style={{ order: 0 }}>
          <div className="label-eyebrow mb-2.5">In use</div>
          <div className="mono text-[28px] font-semibold">
            {data?.activeClaims ?? "—"}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-soft">
            active claims on this checklist
          </div>
          <div className="notice">
            <b>Changes apply going forward only.</b> A claim keeps the checklist
            it was opened with, so editing this list never changes what&apos;s
            required on a claim already in progress.
          </div>
          {!canEdit ? (
            <div
              className="notice"
              style={{ borderLeftColor: "var(--pending)" }}
            >
              You can view these rules but not change them — ask a desk head or
              admin.
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
