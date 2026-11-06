import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useConfirmDocument } from "../documents/api";
import { ChecklistGapsCard } from "./ChecklistGapsCard";
import { DeductionRiskCard } from "./DeductionRiskCard";
import { UploadedDocumentsCard } from "./UploadedDocumentsCard";
import type { Claim, ClaimGaps } from "./types";

/**
 * The claim's documents tab, and the drag that connects its two halves.
 *
 * The brief asks for misfiled documents to be *dragged* to the right
 * slot, and this is the screen where that sentence makes sense: the gap
 * view is already on the page saying what is missing, so "put this one
 * there" is a shorter thought than reading a slot name out of a
 * dropdown and pressing Confirm.
 *
 * The dropdown stays. Drag is never the only way to file something —
 * it is a pointer gesture, and a desk on a laptop trackpad filing
 * twenty scans will still find the list faster.
 *
 * The drop calls the same confirm mutation the button does, so the
 * audit entry, the gap recount and the adr 0005 rule that a human
 * places every document are all untouched. Dragging is a way of saying
 * which slot, not a way of skipping the saying.
 */
export function ClaimDocumentsTab({
  claim,
  gaps,
}: {
  claim: Claim;
  gaps: ClaimGaps | undefined;
}) {
  const confirmDoc = useConfirmDocument(claim.id);
  const [dragging, setDragging] = useState<{
    fileName: string;
    slot: string | null;
  } | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, or every click on
    // the filename, Confirm or Discard would be swallowed as a
    // zero-distance drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    setDragging({
      fileName: String(data?.fileName ?? "Document"),
      slot: (data?.slot as string | null) ?? null,
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const slot = event.over?.data.current?.slot as string | undefined;
    if (!slot) return;
    // Dropping something back where it already is isn't a correction,
    // and writing it would put a pointless entry in the audit trail.
    if (event.active.data.current?.slot === slot) return;
    confirmDoc.mutate({
      documentId: String(event.active.id),
      checklistSlot: slot,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex flex-col gap-[18px]">
        <ChecklistGapsCard claim={claim} gaps={gaps} />
        {/* Under the gaps, not above them: it argues for closing those
            specific gaps, so it only makes sense once you've seen which
            ones are open. */}
        <DeductionRiskCard claim={claim} />
        <UploadedDocumentsCard claim={claim} />
      </div>

      {/* Follows the cursor across the gap between the two cards, which
          is most of the distance travelled. Without it the row stays
          put and the drag looks like it failed. */}
      <DragOverlay>
        {dragging ? (
          <div className="rounded-md border border-accent bg-surface-raised px-[13px] py-2 text-sm font-semibold text-ink shadow-card">
            {dragging.fileName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
