import { useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "reicon-react";
import {
  PREAUTH_FIELD_TYPES,
  placementLabel,
  type PreauthPlacement,
} from "@claimflow/contracts";
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
import {
  useAddPlacement,
  useAddSection,
  useCreateField,
  useDeleteField,
  useDeleteSection,
  useFieldDefinitions,
  usePreauthLayout,
  useRemovePlacement,
  useReorderPlacements,
  useUpdatePlacement,
} from "./layout-api";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * The pre-auth form builder.
 *
 * Edits the *live* layout. Claims already open are unaffected — each
 * freezes a copy when it's created (docs/adr/0001), which is why this
 * screen can be used mid-month without rewriting history. The banner
 * says so, because "will this change claims already sent?" is the first
 * thing an admin will wonder and the answer isn't visible otherwise.
 */
export function PreauthFormBuilder() {
  const { data: layout, isLoading } = usePreauthLayout();
  const addSection = useAddSection();
  const deleteSection = useDeleteSection();
  const addPlacement = useAddPlacement();
  const updatePlacement = useUpdatePlacement();
  const removePlacement = useRemovePlacement();
  const reorder = useReorderPlacements();

  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  const busy =
    addSection.isPending ||
    deleteSection.isPending ||
    addPlacement.isPending ||
    updatePlacement.isPending ||
    removePlacement.isPending ||
    reorder.isPending;

  if (isLoading) return <Loader label="Loading the form…" />;
  if (!layout) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
        Couldn&apos;t load the form.
      </div>
    );
  }

  const used = new Set(
    layout.sections.flatMap((s) => s.placements.map((p) => p.definition.id)),
  );

  /** Moves a field within its section by swapping display orders. */
  function move(
    sectionId: string,
    placements: PreauthPlacement[],
    index: number,
    delta: number,
  ) {
    const next = index + delta;
    if (next < 0 || next >= placements.length) return;
    const reordered = [...placements];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(next, 0, moved!);
    reorder.mutate(
      reordered.map((p, i) => ({
        id: p.id,
        sectionId,
        displayOrder: i,
      })),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre-auth form</CardTitle>
        <span className="text-sm text-ink-faint">{layout.name}</span>
      </CardHeader>

      <p className="m-0 mb-4 max-w-[62ch] text-sm leading-normal text-ink-faint">
        Changes apply to claims opened from now on. Claims already in progress
        keep the form they were opened with, so a query six weeks from now can
        still be answered against what was actually sent.
      </p>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mb-3">
          {error}
        </div>
      ) : null}

      {layout.sections.map((section) => (
        <section
          key={section.id}
          className="mb-3.5 rounded-lg border border-line p-3.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2.5 [&_h3]:m-0 [&_h3]:text-base [&_h3]:font-semibold">
            <h3>{section.name}</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => deleteSection.mutate(section.id)}
            >
              Remove section
            </Button>
          </div>

          {section.placements.length === 0 ? (
            <p className="px-1 py-2.5 text-base text-ink-faint">
              Nothing on this section yet.
            </p>
          ) : (
            <ul className="m-0 mb-2.5 flex list-none flex-col p-0">
              {section.placements.map((placement, index) => (
                <li
                  key={placement.id}
                  className="grid grid-cols-1 items-center gap-1.5 border-b border-line px-0.5 py-[9px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-base font-medium">
                      {placementLabel(placement)}
                      {placement.definition.isStandard ? (
                        <Badge variant="neutral">IRDAI</Badge>
                      ) : (
                        <Badge variant="pending">Custom</Badge>
                      )}
                    </span>
                    <span className="text-xs text-ink-faint font-mono tabular-nums">
                      {placement.definition.fieldKey} ·{" "}
                      {placement.definition.fieldType}
                    </span>
                  </div>

                  <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-ink-soft">
                    <input
                      type="checkbox"
                      checked={placement.required}
                      disabled={busy}
                      onChange={(e) =>
                        updatePlacement.mutate({
                          id: placement.id,
                          required: e.target.checked,
                        })
                      }
                    />
                    Required
                  </label>

                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
                      aria-label={`Move ${placementLabel(placement)} up`}
                      disabled={busy || index === 0}
                      onClick={() =>
                        move(section.id, section.placements, index, -1)
                      }
                    >
                      <ChevronUp size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
                      aria-label={`Move ${placementLabel(placement)} down`}
                      disabled={busy || index === section.placements.length - 1}
                      onClick={() =>
                        move(section.id, section.placements, index, 1)
                      }
                    >
                      <ChevronDown size={13} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
                      aria-label={`Take ${placementLabel(placement)} off the form`}
                      title="Take off the form"
                      disabled={busy}
                      onClick={() => removePlacement.mutate(placement.id)}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {picking === section.id ? (
            <FieldPicker
              used={used}
              onCancel={() => setPicking(null)}
              onPick={(definitionId) => {
                addPlacement.mutate({
                  sectionId: section.id,
                  fieldDefinitionId: definitionId,
                  displayOrder: section.placements.length,
                });
                setPicking(null);
              }}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setPicking(section.id)}
            >
              Add a field
            </Button>
          )}
        </section>
      ))}

      <form
        className="my-[18px] flex items-center gap-2 [&>*:first-child]:flex-[1_1_240px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newSection.trim()) return;
          addSection.mutate(
            {
              layoutId: layout.id,
              name: newSection.trim(),
              displayOrder: layout.sections.length,
            },
            { onSuccess: () => setNewSection("") },
          );
        }}
      >
        <Input
          aria-label="New section name"
          placeholder="New section, e.g. Maternity"
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
        />
        <Button type="submit" disabled={!newSection.trim() || busy}>
          Add section
        </Button>
      </form>

      <CustomFieldForm onError={setError} />
    </Card>
  );
}

/**
 * The field palette, following the b2b-crm's FieldTypeSelector: a
 * searchable list of 36px rows, grouped, with the grip handle appearing
 * on hover.
 *
 * Its geometry and interaction are replicated; its colours come from
 * ClaimFlow's tokens rather than the CRM's hardcoded greys and blue, so
 * the panel doesn't read as a transplant from another product sitting
 * inside this one.
 */
function FieldPicker({
  used,
  onPick,
  onCancel,
}: {
  used: Set<string>;
  onPick: (definitionId: string) => void;
  onCancel: () => void;
}) {
  const { data: fields, isLoading } = useFieldDefinitions();
  const [search, setSearch] = useState("");

  const available = (fields ?? []).filter((f) => !used.has(f.id));
  const query = search.trim().toLowerCase();
  const matching = query
    ? available.filter(
        (f) =>
          f.label.toLowerCase().includes(query) ||
          f.fieldKey.toLowerCase().includes(query),
      )
    : available;

  const groups: { key: string; label: string; rows: typeof matching }[] = [
    {
      key: "standard",
      label: "IRDAI",
      rows: matching.filter((f) => f.isStandard),
    },
    {
      key: "custom",
      label: "Yours",
      rows: matching.filter((f) => !f.isStandard),
    },
  ].filter((g) => g.rows.length > 0);

  if (isLoading) return <Loader label="Loading fields…" />;

  return (
    <div className="max-w-[420px] overflow-hidden rounded-lg border border-line-strong bg-surface-raised shadow-[0_6px_20px_rgba(28,27,23,0.08)]">
      <div className="flex items-center justify-between border-b border-line px-3.5 pb-2 pt-3">
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Field types
        </span>
        <button
          type="button"
          className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
          onClick={onCancel}
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className="relative border-b border-line px-2.5 py-2 text-ink-faint [&_input]:h-8 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-surface [&_input]:py-0 [&_input]:pl-[30px] [&_input]:pr-2.5 [&_input]:font-[inherit] [&_input]:text-sm [&_input]:text-ink [&_input]:outline-none [&_input:focus-visible]:outline [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-1 [&_input:focus-visible]:outline-accent [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-[19px] [&_svg]:top-1/2 [&_svg]:size-3 [&_svg]:-translate-y-1/2">
        <Search aria-hidden />
        <input
          type="text"
          placeholder="Search fields…"
          aria-label="Search fields"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="max-h-[320px] overflow-y-auto py-1.5">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="px-3.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint">
              {group.label}
            </div>
            {group.rows.map((field) => (
              <button
                key={field.id}
                type="button"
                className="group flex h-9 w-full cursor-pointer items-center gap-[9px] border-0 bg-transparent px-3.5 font-[inherit] hover:bg-accent-soft"
                onClick={() => onPick(field.id)}
              >
                <span
                  className="w-4 shrink-0 text-center text-sm text-ink-faint group-hover:text-accent-ink"
                  aria-hidden
                >
                  {TYPE_GLYPH[field.fieldType] ?? "▢"}
                </span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-base text-ink">
                  {field.label}
                </span>
                <span className="shrink-0 text-2xs text-ink-faint font-mono tabular-nums">
                  {field.fieldType}
                </span>
                <span
                  className="shrink-0 text-2xs text-ink-faint opacity-0 group-hover:opacity-100"
                  aria-hidden
                >
                  ⠿
                </span>
              </button>
            ))}
          </div>
        ))}

        {matching.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-sm text-ink-faint">
            {available.length === 0
              ? "Every field is already on the form. Create one below."
              : `No fields match “${search}”`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One glyph per type, so the palette scans by shape as well as by word. */
const TYPE_GLYPH: Record<string, string> = {
  text: "T",
  longtext: "¶",
  integer: "#",
  currency: "₹",
  date: "▦",
  time: "◷",
  enum: "▾",
  file: "⇧",
};

/** A field the hospital invented, on top of the IRDAI set. */
function CustomFieldForm({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const create = useCreateField();
  const remove = useDeleteField();
  const { data: fields } = useFieldDefinitions();

  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const custom = (fields ?? []).filter((f) => !f.isStandard);

  /** "Attendant name" → attendantName. The key is storage, the label is for people. */
  function keyFor(text: string): string {
    const words = text
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (words.length === 0) return "";
    return (
      words[0]! +
      words
        .slice(1)
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join("")
    );
  }

  const fieldKey = keyFor(label);

  return (
    <div className="mt-1.5 border-t border-line pt-[18px] [&_h3]:m-0 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold">
      <h3>Your own fields</h3>
      <p className="m-0 mb-4 max-w-[62ch] text-sm leading-normal text-ink-faint">
        The 24 IRDAI fields can be reordered or taken off a form, but not
        deleted — a TPA expects them to mean what they say. Anything you add
        here is yours.
      </p>

      <form
        className="mb-4 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*:first-child]:sm:flex-[2_1_200px] [&>*:nth-child(2)]:sm:flex-[0_1_130px] [&>*:nth-child(3)]:sm:flex-[0_1_130px] [&>*:nth-child(4)]:sm:flex-[1_1_180px]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!fieldKey) return;
          onError(null);
          try {
            await create.mutateAsync({
              fieldKey,
              label: label.trim(),
              fieldType: type,
            });
            setLabel("");
          } catch (err) {
            onError(
              err instanceof Error
                ? err.message
                : "Couldn't create that field.",
            );
          }
        }}
      >
        <Input
          aria-label="Field label"
          placeholder="e.g. Attendant name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Field type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PREAUTH_FIELD_TYPES.map((t) => (
              <SelectItem key={t.type} value={t.type}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!fieldKey || create.isPending}>
          Create field
        </Button>
      </form>

      {fieldKey ? (
        <p className="m-0 mb-4 max-w-[62ch] text-sm leading-normal text-ink-faint font-mono tabular-nums">
          Stored as {fieldKey}
        </p>
      ) : null}

      {custom.length > 0 ? (
        <ul className="m-0 mb-2.5 flex list-none flex-col p-0">
          {custom.map((field) => (
            <li
              key={field.id}
              className="grid grid-cols-1 items-center gap-1.5 border-b border-line px-0.5 py-[9px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-base font-medium">
                  {field.label}
                </span>
                <span className="text-xs text-ink-faint font-mono tabular-nums">
                  {field.fieldKey} · {field.fieldType}
                </span>
              </div>
              <button
                type="button"
                className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
                aria-label={`Delete ${field.label}`}
                title="Delete this field everywhere"
                disabled={remove.isPending}
                onClick={async () => {
                  onError(null);
                  try {
                    await remove.mutateAsync(field.id);
                  } catch (err) {
                    onError(
                      err instanceof Error
                        ? err.message
                        : "Couldn't delete that field.",
                    );
                  }
                }}
              >
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
