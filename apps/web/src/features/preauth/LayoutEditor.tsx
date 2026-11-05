import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Add, Lock, Reorder, Search, Trash, X } from "reicon-react";
import {
  PREAUTH_FIELD_TYPES,
  columnPlacements,
  placementLabel,
  type PreauthLayout,
  type PreauthPlacement,
  type PreauthSection,
} from "@claimflow/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import {
  useAddPlacement,
  useAddSection,
  useCreateField,
  useDeleteSection,
  useFieldDefinitions,
  useCustomiseForInsurer,
  usePreauthLayout,
  useRevertToDefaultLayout,
  useRemovePlacement,
  useReorderPlacements,
  useReorderSections,
  useSetSectionColumns,
  useUpdatePlacement,
  type FieldDefinitionRow,
} from "./layout-api";

/** Every column gets this droppable even when it already has rows — see onDragEnd for why. */
function emptyColumnId(sectionId: string, column: 0 | 1): string {
  return `column:${sectionId}:${column}`;
}

function parseEmptyColumnId(
  id: string,
): { sectionId: string; column: 0 | 1 } | null {
  const match = /^column:([^:]+):([01])$/.exec(id);
  if (!match) return null;
  return { sectionId: match[1]!, column: Number(match[2]) as 0 | 1 };
}

/**
 * The pre-auth layout editor.
 *
 * Follows the b2b-crm's layout designer: a palette on the left split
 * into field types you can add and existing fields not currently on the
 * form, and a canvas of sections on the right, each one or two columns,
 * with fields dragged into place.
 *
 * Two deliberate departures. Standard IRDAI fields show a padlock and
 * can be taken off the form but never deleted — a TPA expects "ICD-10
 * code" to mean an ICD-10 code. And the whole thing edits the *live*
 * layout: every claim froze its own copy when it was opened
 * (docs/adr/0001), which is what makes editing mid-month safe.
 */
export function LayoutEditor({
  insurerId,
  insurerName,
}: {
  /** Whose form to edit. Omitted edits the shared default. */
  insurerId?: string | undefined;
  insurerName?: string | undefined;
} = {}) {
  const { data: layout, isLoading } = usePreauthLayout(insurerId);
  const customise = useCustomiseForInsurer();
  const revert = useRevertToDefaultLayout();
  // The resolver falls back, so a layout with no insurer on it is the
  // shared one being borrowed rather than this insurer's own.
  const isOwnForm = Boolean(insurerId) && layout?.insurerId === insurerId;
  const { data: definitions } = useFieldDefinitions();
  const addSection = useAddSection();
  const deleteSection = useDeleteSection();
  const setColumns = useSetSectionColumns();
  const addPlacement = useAddPlacement();
  const updatePlacement = useUpdatePlacement();
  const removePlacement = useRemovePlacement();
  const reorder = useReorderPlacements();
  const reorderSections = useReorderSections();
  const createField = useCreateField();

  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newSection, setNewSection] = useState("");
  const [showNewSection, setShowNewSection] = useState(false);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a row's
    // buttons doesn't register as a failed drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const used = useMemo(
    () =>
      new Set(
        (layout?.sections ?? []).flatMap((s) =>
          s.placements.map((p) => p.definition.id),
        ),
      ),
    [layout],
  );

  const unused = (definitions ?? []).filter((d) => !used.has(d.id));
  const query = search.trim().toLowerCase();
  const matches = (text: string) =>
    !query || text.toLowerCase().includes(query);

  if (isLoading) return <Loader label="Loading the form…" />;
  if (!layout) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical">
        Couldn&apos;t load the form.
      </div>
    );
  }

  /**
   * Dragging a section and dragging a field are both handled by this one
   * DndContext — sections have their own SortableContext around the
   * list, fields have one per column — so the first job here is telling
   * which kind of thing was actually picked up.
   */
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sectionDrag = layout!.sections.some((s) => s.id === active.id);
    if (sectionDrag) {
      onSectionDragEnd(String(active.id), String(over.id));
      return;
    }
    onFieldDragEnd(String(active.id), String(over.id));
  }

  function onSectionDragEnd(activeId: string, overId: string) {
    const ordered = [...layout!.sections].sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
    const activeIndex = ordered.findIndex((s) => s.id === activeId);
    const overIndex = ordered.findIndex((s) => s.id === overId);
    if (activeIndex === -1 || overIndex === -1) return;

    const reordered = arrayMove(ordered, activeIndex, overIndex);
    reorderSections.mutate(
      reordered.map((s, i) => ({ id: s.id, displayOrder: i })),
    );
  }

  /**
   * Drops a dragged field into a column — either onto another field
   * (insert at its position) or, via the column's own droppable, into a
   * column that's empty or being dropped at past its last row.
   *
   * Both the destination column AND the column the field left are fully
   * renumbered, not just spliced: renumbering only the destination was
   * the bug behind fields moved across columns or sections leaving a
   * gap in the old column's order.
   */
  function onFieldDragEnd(activeId: string, overId: string) {
    const moved = findPlacement(layout!, activeId);
    if (!moved) return;

    const targetPlacement = findPlacement(layout!, overId);
    const targetColumn = targetPlacement
      ? {
          sectionId: targetPlacement.section.id,
          column: (targetPlacement.placement.columnPosition ?? 0) as 0 | 1,
        }
      : parseEmptyColumnId(overId);
    if (!targetColumn) return;

    const targetSection = layout!.sections.find(
      (s) => s.id === targetColumn.sectionId,
    );
    if (!targetSection) return;

    const destination = columnPlacements(
      targetSection,
      targetColumn.column,
    ).filter((p) => p.id !== moved.placement.id);
    const insertIndex = targetPlacement
      ? destination.findIndex((p) => p.id === targetPlacement.placement.id)
      : destination.length;
    destination.splice(
      insertIndex < 0 ? destination.length : insertIndex,
      0,
      moved.placement,
    );

    const updates = destination.map((p, i) => ({
      id: p.id,
      sectionId: targetSection.id,
      displayOrder: i,
      columnPosition: targetColumn.column,
    }));

    const movedFromColumn = (moved.placement.columnPosition ?? 0) as 0 | 1;
    const leftItsColumn =
      moved.section.id !== targetSection.id ||
      movedFromColumn !== targetColumn.column;
    if (leftItsColumn) {
      const source = columnPlacements(moved.section, movedFromColumn).filter(
        (p) => p.id !== moved.placement.id,
      );
      updates.push(
        ...source.map((p, i) => ({
          id: p.id,
          sectionId: moved.section.id,
          displayOrder: i,
          columnPosition: movedFromColumn,
        })),
      );
    }

    reorder.mutate(updates);
  }

  function addFieldTo(section: PreauthSection, column: 0 | 1, id: string) {
    addPlacement.mutate({
      sectionId: section.id,
      fieldDefinitionId: id,
      displayOrder: columnPlacements(section, column).length,
      columnPosition: column,
    });
  }

  const firstSection = layout.sections[0];

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="static max-h-none overflow-y-auto rounded-lg border border-line bg-surface-raised lg:sticky lg:top-5 lg:max-h-[calc(100vh-60px)]">
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

        <div className="px-3 pb-1.5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint [&_span]:font-medium">
          New fields <span>({PREAUTH_FIELD_TYPES.length})</span>
        </div>
        <div className="grid grid-cols-2 border-t border-line">
          {PREAUTH_FIELD_TYPES.filter((t) => matches(t.label)).map((type) => (
            <button
              key={type.type}
              type="button"
              className="flex cursor-pointer items-center gap-1.5 border-0 border-b border-r border-line bg-transparent px-2.5 py-[9px] text-left font-[inherit] text-sm text-ink even:border-r-0 enabled:hover:bg-accent-soft disabled:cursor-default disabled:opacity-45"
              disabled={!firstSection || createField.isPending}
              title={`Add a new ${type.label.toLowerCase()} field`}
              onClick={async () => {
                setError(null);
                const label = window.prompt(
                  `Name for the new ${type.label.toLowerCase()} field`,
                );
                if (!label?.trim() || !firstSection) return;
                try {
                  const created = await createField.mutateAsync({
                    fieldKey: camelKey(label),
                    label: label.trim(),
                    fieldType: type.type,
                  });
                  addFieldTo(firstSection, 0, created.id);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Couldn't create that field.",
                  );
                }
              }}
            >
              <Add size={11} className="shrink-0 text-ink-faint" aria-hidden />
              {type.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mx-2.5 my-3 block w-[calc(100%-20px)] cursor-pointer rounded-md border border-dashed border-line-strong bg-transparent p-[9px] font-[inherit] text-sm font-semibold text-ink-soft hover:border-accent hover:text-accent-ink"
          onClick={() => setShowNewSection((v) => !v)}
        >
          + New section
        </button>

        {showNewSection ? (
          <form
            className="flex gap-1.5 px-2.5 pb-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSection.trim()) return;
              addSection.mutate(
                {
                  layoutId: layout.id,
                  name: newSection.trim(),
                  displayOrder: layout.sections.length,
                },
                {
                  onSuccess: () => {
                    setNewSection("");
                    setShowNewSection(false);
                  },
                },
              );
            }}
          >
            <Input
              aria-label="Section name"
              placeholder="e.g. Maternity"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!newSection.trim()}>
              Add
            </Button>
          </form>
        ) : null}

        <div className="px-3 pb-1.5 pt-3 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-faint [&_span]:font-medium">
          Unused fields <span>({unused.length})</span>
        </div>
        <ul className="m-0 list-none border-t border-line p-0 pb-2.5">
          {unused
            .filter((f) => matches(f.label))
            .map((field) => (
              <li key={field.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-2.5 border-0 border-b border-line bg-transparent px-3 py-[9px] text-left font-[inherit] enabled:hover:bg-accent-soft"
                  disabled={!firstSection}
                  title="Add to the first section"
                  onClick={() =>
                    firstSection && addFieldTo(firstSection, 0, field.id)
                  }
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base">
                    {field.label}
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {field.fieldType}
                  </span>
                </button>
              </li>
            ))}
          {unused.length === 0 ? (
            <li className="px-3.5 py-6 text-center text-sm text-ink-faint">
              Every field is on the form.
            </li>
          ) : null}
        </ul>
      </aside>

      <div className="min-w-0">
        {error ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-critical bg-critical-bg px-3.5 py-2.5 text-base font-medium text-critical mb-3">
            {error}
          </div>
        ) : null}

        {/*
          Says whose form is on screen before anything is dragged.
          Editing while believing you are on one insurer's form and
          actually being on the shared one changes it for every insurer
          at once.
        */}
        {insurerId ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-raised px-3.5 py-3">
            <p className="m-0 max-w-[62ch] text-base text-ink">
              {isOwnForm ? (
                <>
                  <b className="font-semibold">{insurerName}</b> has its own
                  form. Edits here affect only their claims.
                </>
              ) : (
                <>
                  <b className="font-semibold">{insurerName}</b> uses the shared
                  form. Editing now changes it for every insurer without one of
                  their own.
                </>
              )}
            </p>
            {isOwnForm ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={revert.isPending}
                onClick={() => revert.mutate(insurerId)}
              >
                {revert.isPending ? "Reverting…" : "Revert to the shared form"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={customise.isPending}
                onClick={() => customise.mutate(insurerId)}
              >
                {customise.isPending
                  ? "Creating…"
                  : `Give ${insurerName} its own form`}
              </Button>
            )}
          </div>
        ) : null}

        <p className="m-0 mb-4 max-w-[62ch] text-sm leading-normal text-ink-faint">
          Changes apply to claims opened from now on. Claims already in progress
          keep the form they were opened with.
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={layout.sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            {layout.sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                onToggleColumns={() =>
                  setColumns.mutate({
                    id: section.id,
                    columnCount: section.columnCount === 2 ? 1 : 2,
                  })
                }
                onDelete={() => deleteSection.mutate(section.id)}
              >
                <div
                  className={`grid grid-cols-1${section.columnCount === 2 ? " lg:grid-cols-2" : ""}`}
                >
                  {(section.columnCount === 2
                    ? ([0, 1] as const)
                    : ([0] as const)
                  ).map((column) => {
                    const rows = columnPlacements(section, column);
                    return (
                      <ColumnDropZone
                        key={column}
                        id={emptyColumnId(section.id, column)}
                        className="min-w-0 border-b border-line last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
                      >
                        {section.columnCount === 2 ? (
                          <div className="border-b border-line px-[13px] py-[7px] text-xs text-ink-faint">
                            Column {column + 1}
                          </div>
                        ) : null}
                        <SortableContext
                          items={rows.map((r) => r.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {rows.map((placement) => (
                            <FieldRow
                              key={placement.id}
                              placement={placement}
                              onToggleRequired={() =>
                                updatePlacement.mutate({
                                  id: placement.id,
                                  required: !placement.required,
                                })
                              }
                              onRemove={() =>
                                removePlacement.mutate(placement.id)
                              }
                            />
                          ))}
                        </SortableContext>
                        {rows.length === 0 ? (
                          <div className="px-[13px] py-3.5 text-sm italic text-ink-faint">
                            Empty slot — drop a field here
                          </div>
                        ) : null}
                      </ColumnDropZone>
                    );
                  })}
                </div>
              </SectionCard>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

/** One draggable field row. */
function FieldRow({
  placement,
  onToggleRequired,
  onRemove,
}: {
  placement: PreauthPlacement;
  onToggleRequired: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: placement.id });
  const standard = placement.definition.isStandard;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-[9px] border-b border-line bg-surface-raised px-[13px] py-2.5 last:border-b-0${
        standard ? " border-l-[3px] border-l-accent" : ""
      }${isDragging ? " opacity-50" : ""}`}
    >
      <span
        className="flex shrink-0 cursor-grab select-none items-center text-ink-faint active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${placementLabel(placement)}`}
      >
        {standard ? <Lock size={13} /> : <Reorder size={13} />}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base">
        {placementLabel(placement)}
      </span>
      <button
        type="button"
        className={`shrink-0 cursor-pointer rounded-xs border bg-transparent px-[7px] py-0.5 font-[inherit] text-2xs font-semibold uppercase tracking-[0.03em] ${
          placement.required
            ? "border-critical bg-critical-bg text-critical"
            : "border-line text-ink-faint"
        }`}
        onClick={onToggleRequired}
        title={placement.required ? "Make optional" : "Make required"}
      >
        {placement.required ? "Required" : "Optional"}
      </button>
      <span className="shrink-0 text-xs text-ink-faint">
        {placement.definition.fieldType}
      </span>
      <button
        type="button"
        className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-sm leading-none text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
        aria-label={`Take ${placementLabel(placement)} off the form`}
        title="Take off the form"
        onClick={onRemove}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

/** A section's header, drag handle, and column/delete actions — the field columns are passed in as children. */
function SectionCard({
  section,
  onToggleColumns,
  onDelete,
  children,
}: {
  section: PreauthSection;
  onToggleColumns: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`mb-3.5 overflow-hidden rounded-lg border border-line bg-surface-raised${isDragging ? " opacity-50" : ""}`}
    >
      <div className="flex items-center gap-[9px] border-b border-line bg-surface px-[13px] py-[11px] [&_h3]:m-0 [&_h3]:flex-1 [&_h3]:text-base [&_h3]:font-semibold">
        <span
          className="flex shrink-0 cursor-grab select-none items-center text-ink-faint active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${section.name}`}
        >
          <Reorder size={14} />
        </span>
        <h3>{section.name}</h3>
        <div className="flex gap-0.5">
          <button
            type="button"
            className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-ink-soft enabled:hover:border-line-strong enabled:hover:text-ink disabled:cursor-default disabled:opacity-30"
            aria-label={`Use ${section.columnCount === 2 ? "one column" : "two columns"}`}
            title={
              section.columnCount === 2
                ? "Switch to one column"
                : "Switch to two columns"
            }
            onClick={onToggleColumns}
          >
            <ColumnsPreview count={section.columnCount === 2 ? 2 : 1} />
          </button>
          <button
            type="button"
            className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent text-ink-soft enabled:hover:border-line-strong enabled:hover:text-critical disabled:cursor-default disabled:opacity-30"
            aria-label={`Delete ${section.name}`}
            onClick={onDelete}
          >
            <Trash size={14} aria-hidden />
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}

/** A tiny 1- or 2-box glyph for the column-count toggle — plain boxes rather than a borrowed icon, since no icon in the set means "this many columns" as directly as drawing them. */
function ColumnsPreview({ count }: { count: 1 | 2 }) {
  return (
    <span className="flex h-3 w-4 shrink-0 gap-[2px]" aria-hidden>
      <span className="flex-1 rounded-[1.5px] border border-current" />
      {count === 2 ? (
        <span className="flex-1 rounded-[1.5px] border border-current" />
      ) : null}
    </span>
  );
}

/** A column's drop target, kept droppable even when it already has rows — dnd-kit has nothing to land a drag on in a column with zero items otherwise, which made dragging a field into an empty section or column simply not work. */
function ColumnDropZone({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

function findPlacement(
  layout: PreauthLayout,
  placementId: string,
): { section: PreauthSection; placement: PreauthPlacement } | undefined {
  for (const section of layout.sections) {
    const placement = section.placements.find((p) => p.id === placementId);
    if (placement) return { section, placement };
  }
  return undefined;
}

/** "Attendant name" → attendantName. The key is storage; the label is for people. */
function camelKey(text: string): string {
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

export type { FieldDefinitionRow };
