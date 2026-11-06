import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";

/**
 * A stop before something that cannot be undone.
 *
 * Discarding a document deleted the row *and* the object in S3 on a
 * single click, from a button sitting next to Confirm. The two are a
 * mouse-width apart and one of them is final.
 *
 * Deliberately not a generic "Are you sure?" — the title says what
 * will happen to which thing, and the confirm button repeats the verb
 * rather than saying OK, so a reader who only looks at the button
 * still knows what they are agreeing to.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The verb, not "OK" — "Discard the file", "Remove the slot". */
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader title={title} description={description} />
        <div className="flex justify-end gap-2.5">
          {/* Cancel first and plain, the destructive one last and
              marked — the opposite order makes "get rid of this"
              the resting position of the hand. */}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
