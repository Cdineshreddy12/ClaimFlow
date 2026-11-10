import { ROLE_LABEL } from "../../lib/roles";
import { useAuth } from "../auth/AuthProvider";
import { useAssignClaim, useRoster, type RosterMember } from "./api";
import type { Claim } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The sentinel Radix needs, because a Select item cannot carry an empty value. */
const NOBODY = "__nobody__";

/**
 * Who on the desk owns this claim.
 *
 * `claims.assigned_to` decides what a desk executive can see, and until
 * now nothing in the product could set it — the scoping shipped with
 * only its read half, so a role restricted to its own claims had no way
 * to be given any and saw an empty desk on every screen.
 *
 * Read-only for an executive. Not because seeing the name is sensitive
 * — they work alongside these people — but because changing it is the
 * decision the scoping exists to enforce, and a picker they cannot use
 * is more honest than one that 403s on click.
 */
export function AssigneeRow({ claim }: { claim: Claim }) {
  const { role } = useAuth();
  const roster = useRoster();
  const assign = useAssignClaim(claim.id);

  const canAssign = role === "org_admin" || role === "desk_head";
  const current = roster.data?.find((m) => m.id === claim.assignedTo);

  if (!canAssign) {
    return (
      <div>
        <dt>Assigned to</dt>
        <dd>
          {claim.assignedTo === null ? (
            <span className="font-medium text-ink-faint">Unassigned</span>
          ) : (
            <span className="truncate">
              {nameOf(current, claim.assignedTo)}
            </span>
          )}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <dt>Assigned to</dt>
      <dd className="min-w-0">
        <Select
          value={claim.assignedTo ?? NOBODY}
          disabled={assign.isPending || roster.isLoading}
          onValueChange={(next) => assign.mutate(next === NOBODY ? null : next)}
        >
          {/* Sized to the rail rather than the longest address in the
              roster: these are email addresses, and one long enough to
              widen the column would push the whole card past it. */}
          <SelectTrigger
            aria-label="Assign this claim"
            className="h-auto max-w-[170px] border-0 bg-transparent px-0 py-0 text-right text-base font-semibold"
          >
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>Unassigned</SelectItem>
            {(roster.data ?? []).map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {nameOf(member, member.id)} · {ROLE_LABEL[member.role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {assign.isError ? (
          <span className="block text-sm font-normal text-critical">
            Couldn&apos;t reassign that claim.
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The local part of the address, which is what distinguishes colleagues
 * at one hospital — every one of them shares the domain, and the rail
 * has room for about twenty characters.
 */
function nameOf(member: RosterMember | undefined, fallbackId: string): string {
  if (!member?.email) return member ? "Unknown member" : fallbackId.slice(0, 8);
  return member.email.split("@")[0]!;
}
