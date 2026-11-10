# 0017 — The desk assistant, and why it cannot act

**Status: built. Attachments, recognition, the tool loop, proposals and
the approval path are in. The conversation itself is not persisted.**

## Context

Everything the product reads so far has had a claim handed to it. A
document is uploaded _to_ a claim; a pre-auth form is extracted _from_
that claim's confirmed documents; a query is logged _against_ one. The
desk has to know the answer before the software will help.

That is not how the paper arrives. A ward sends up a folder, a relative
hands over a discharge summary at the counter, a WhatsApp group fills
with photographs of cards and reports. Before any of it can be uploaded,
someone opens each file, reads a name, searches the claims list, and
only then uploads — and that lookup, repeated per page, is most of the
filing work.

The brief asked for a chat window that takes files, recognises them,
maps them to claims, and asks permission. The ask contains the whole
design problem: "maps them" and "asks permission" pull in opposite
directions, and which one wins decides what this thing is.

## Decision

### The model proposes; it never acts

Tools are split along one line — whether running it changes anything.

- **Read tools execute inside the conversation loop.** `search_claims`,
  `get_claim`, `list_queries`, `get_sla_watch`, `get_deduction_risk`,
  `run_presubmission_review`. Looking something up changes nothing, so
  there is nothing to approve — including the review, which costs a
  model call but writes nothing. Asking permission to look at something
  is a round trip for nothing.
- **Write tools are never executed at all.** `file_document`,
  `log_query`, `mark_query_replied`, `confirm_query_deadline`. The model
  emitting one produces a card in the panel. The loop stops there, the
  tool result says only "shown to the user", and nothing has happened.

Approval is a separate HTTP request that re-validates the payload and
calls the ordinary service — the same function a button elsewhere in
the app calls, with the same role check and the same audit row. There
is no write path on the model's side of the approval to get wrong.

This is docs/adr/0005 carried from fields to verbs. That ADR said a
suggestion isn't a value until a human says so; this says a suggestion
isn't an action until a human clicks. The pre-auth form made the rule
about data because data was all the AI touched. Now it touches verbs.

### Authorization goes through the services, not the repositories

Every read tool calls `claims.service` / `queries.service`, which
already force a desk executive to their own assigned claims
(docs/adr/0002). Reaching into the repositories for a tidier query
would have handed anyone the whole desk through a chat window — the
role filter lives in exactly one layer and this is not a second one.

The approval path does the same: `file_document` calls
`claimsService.getClaim` before anything moves, so a claim id the model
produced is checked against what this user may see. A model naming a
claim is not evidence that anyone is allowed to write to it.

### Recognition is its own step, separate from classification

Two passes, not one prompt:

1. **The recogniser** (`integrations/recogniser`) reads the page against
   the open claims and answers _whose claim is this_, quoting what it
   matched on.
2. **The existing classifier** then answers _which slot_, against that
   one claim's checklist.

They could have been merged — the slots depend on which claim was
picked, so a single prompt would need every candidate's checklist
inline. Keeping them apart costs a second call and buys the thing that
matters: the desk can see which half was unsure. The two failures are
not comparable. A wrong slot on the right claim is a drag of the mouse.
A right slot on the wrong patient's claim is a data breach with a
confirmation button on it — which is why the recogniser is told to
abstain on a shared surname rather than pick.

### A document that fits nothing is evidence about the checklist

A scan can belong to a claim and still fit none of its slots — a cost
estimate on a checklist that never asked for one. The assistant
abstains, correctly, and that used to be the end of it: the file sat
unfiled forever.

`add_checklist_slot` is the way out. It proposes the document type as a
rule for that claim's insurer and procedure, approval runs
`checklistService.applyProposal` — the same function the admin screen's
apply button calls — and the audit trail is the one that already
existed. This is docs/adr/0016's argument arriving from the paper
instead of from TPA emails: an insurer asking for a document the
checklist didn't require is the checklist being wrong, in writing.

`file_as_new_slot` is the other half, and the one that deals with the
document in front of you: it adds the slot to **that one claim** and
files into it, as a single approval, because they are one decision.
Splitting them would hand a desk a card that makes an empty slot and
another that fills it, with a half-done job in between if they stopped.
See the amendment to docs/adr/0001 for why a per-claim slot is not a
hole in the forward-only guarantee.

The two are separate cards because they have different blast radii and
different people are entitled to approve them. The assistant proposes
both when the gap looks like it will recur.

Two things the _rule_ proposal deliberately does not do:

- **It does not touch the claim in hand.** Rules are snapshotted at
  creation and never reach back (docs/adr/0001), so the file that
  prompted the proposal still has nowhere to go on that claim. The card
  says this in as many words rather than letting an approval read as a
  fix.
- **It is not a desk executive's to approve.** A rule change applies to
  every future claim for a pair, which is why the admin routes gate on
  org_admin/desk_head. The tool is withheld from a desk executive's
  tool list as a courtesy and refused in the service as the actual
  gate — the list is a hint, and calling the service directly would
  otherwise walk past the route that enforces it.

### Attachments are a table, the conversation is not

`assistant_attachments` exists because `documents` requires a claim and
always should; a file with no claim yet is genuinely a different thing,
and it needs somewhere to live between landing and being filed. It
carries suggestion columns mirroring `documents`, and `filed_document_id`
as the join back — an attachment nobody approved stays visible as
exactly that.

The chat transcript is not persisted. It lives in the browser and comes
back with each turn. What is worth keeping is already written by the
services the approvals call; a conversations table would mostly
accumulate half-sentences nobody reads, and would make a throwaway
exchange look like a record.

**Reversed, 2026-11-05 — see the amendment below.**

### A floating panel, not a page

The work is interstitial — a scan arrives while someone is mid-claim.
A page of its own would mean navigating away from the thing you were
doing in order to deal with the interruption, which is the interruption
again.

### The worklist, not just the inbox

"What should I do next" was answered from the query inbox alone for as
long as that was the only worklist the assistant could see, which made
it confidently incomplete: a breached SLA clock with a patient waiting
at discharge outranks an unread email, and it could not see one.

`get_sla_watch`, `get_deduction_risk` and `run_presubmission_review`
are the three reads that change that — the clock, the money, and
whether the paperwork survives contact with the insurer. Two of them
only matter before submission; afterwards they are trivia, which is
what the prompt tells the model.

Both risk and review read their claim through the repository rather
than `claims.service`, so the role filter is not on their path. The
tools gate with `claimsService.getClaim` themselves rather than
depending on that detail of someone else's function staying true.

## Amendment — an appeal is the first action, not just an answer (2026-11-10)

`get_appeal_worklist` could tell a desk head that ₹4 lakh of
uncontested deductions were still worth arguing about, and then stop.
Every other insight the assistant surfaces has somewhere to go: a
breached clock is resolved by the ordinary claim actions, a risk
warning by fixing the paperwork before submission. Appeals had no
action path at all, which is precisely the failure docs/adr/0013
describes — "nobody tracks the appeals, so the work is invisible and
therefore never scheduled." Surfacing it and leaving it there is the
same outcome with better information.

`open_appeal` is the proposal, and it differs from the other six in two
ways that were decisions rather than conveniences.

**It takes a list.** Every other proposal acts on one claim or one
query, because every other proposal comes from a claim-level read. This
one comes from a portfolio read, and a card that opens one deduction at
a time against a backlog of forty is the invisibility problem with an
extra click. The cap is ten, which is what a desk can actually read
before approving; an approval nobody read is not an approval.

**Its figures are read from the server, never from the proposal.** The
model passes deduction ids and nothing else. The card resolves them
against the appeal worklist and shows the claim, the patient, the
reason and the amount from there. The amount is the whole basis on
which a desk decides to contest, and approving the model's arithmetic
is not the same act as approving the appeal. It also means the card
only ever offers what is still `NOT_CONTESTED`: the worklist the model
read can be minutes old, and the approval sends the ids the card
displayed rather than the ids the model chose.

The batch is not all-or-nothing. A deduction somebody else contested in
the meantime is counted and reported — "1 opened · 1 already
contested" — rather than failing the batch and leaving the desk to work
out which of the ten landed. Any other error still surfaces; a
deduction id the model invented is a real problem and should not be
absorbed into a count.

No note. `contestDeduction` accepts one and this never sends it: the
argument to the insurer is the desk's to write, and a model-drafted
sentence in the audit record would read as though a person had made it.

The card is offered to the roles that can read the worklist, which is
the same pair the contest route gates on — so unlike
`add_checklist_slot`, there is no audience that can see the need and
not act on it. A test asserts that parity directly rather than
trusting two hand-maintained lists to agree.

What this does not do is finish an appeal. The lifecycle still stops at
`CONTESTED`; the insurer answering is a separate act somebody has to
come back and record, and the card says so rather than reading as
"appeal filed".

## Amendment — streaming, and keeping the conversation (2026-11-05)

Two of the decisions above were right about the mechanism and wrong
about the user.

### The conversation is persisted after all

"A transcript is scratch" holds for what the assistant _did_ — that is
written by the services an approval calls, and audited there. It does
not hold for what it _said_. "What did it tell me about this claim
yesterday" is a fair question, and the answer was being dropped on the
floor every time a tab closed.

`assistant_conversations` keeps two jsonb columns doing two different
jobs, and the split is the point:

- `turns` is the record — what was said, in the shape the panel
  renders. A person comes back to read this.
- `transcript` is machinery — the provider's message blocks, kept only
  so a thread can be continued, still never parsed here.

Deriving the first from the second would couple what a human reads to
someone else's wire format, and that format changing is not a reason
for last month's history to stop rendering.

It also fixes the consequence this ADR originally accepted: the
transcript no longer travels. A turn carries a conversation id, and the
history endpoint deliberately does not return the transcript — putting
it back on the wire on read would undo the change.

Conversations are scoped to the member who held them. Not because a
chat is secret, but because it is a half-formed train of thought, and a
desk head reading a colleague's is a different product from this one.

### Turns are streamed

The loop can spend ten seconds reading claims before it has a word to
say, and ten seconds of silence reads as broken. `/assistant/chat` is
server-sent events now: `text` deltas as the model writes, `tool` in
between so the wait says what it is doing, and `done` carrying the
parts that only exist once the turn is over.

The runner streams whether or not anyone is listening — one code path,
so the buffered caller and the streaming one cannot drift. Errors ride
the stream too: once the headers are out there is no status code left
to say anything with, and failing silently mid-sentence is the worst of
the options.

### Spent cards say so

Persisting conversations meant their cards outlived the tab too, and
reopening last week's thread offered to file a document filed last
week. The approval failed honestly with a 409 — but a button whose only
job is to tell you it should not exist is how a desk learns to distrust
the panel.

`resolved_proposals` on the conversation is a map keyed by the
`tool_use` id the card already carries, so no new identifier had to be
invented or kept in sync. The approval request carries where the card
came from; the history endpoint hands the map back and a spent card
renders as **Done**.

Two deliberate limits:

- **Approvals only.** "Not now" is not spent — it is a decision to
  leave the card alone, and a thread reopened next week should still
  offer it. An approval is the one that cannot be taken twice.
- **The bookkeeping is after the fact and never fatal.** The filing has
  happened and is audited by the service that did it; failing the
  request because a card could not be ticked off would report a success
  as an error and invite the desk to do it again.

### And it stopped asking permission to ask permission

It used to end on "Shall I mark the query replied?" — a round trip to
say yes to something the card itself offers a _Not now_ on. The prompt
now says to propose it. It also says to keep the sentence that goes
with it: not asking is different from saying nothing, and the first
version of this produced a bare card with no context above it.

## Consequences

- **The transcript travels with every turn**, which is what bounds the
  cost of a long session. Capped at 24 messages server-side.
- **Two Claude calls per dropped file** (recogniser, classifier) plus
  OCR, before the chat turn. Measured at ~11s for one page end to end.
  Acceptable while a human is watching one file land; it would not be
  for a fifty-page batch, which is the next thing to make asynchronous.
- **The model will reach for a claim reference over a claim id**, because
  "CLM-0001" is what the page says and what a human would say. It did
  exactly that the first time this ran end to end. References are
  resolved back to ids server-side against the claims the user can
  already see — deterministic, and no wider than their own view.
- **Attachments are scoped to the member who dropped them.** Not a
  privacy boundary — a desk head sees every filed document — but an
  unsorted pile is someone's work in progress, and sharing it would make
  the panel a junk drawer.
- `assistant.proposal_approved` records provenance only. The action
  itself is audited by whichever service performed it; this is the only
  way to ask afterwards which decisions began as a model's suggestion.
- **Without `ANTHROPIC_API_KEY` the panel says so and does nothing
  else.** There is no filename-matching fallback for _whose claim this
  is_, the way there is for what a document is: a filename almost never
  names the patient, and guessing at the one decision that could put a
  stranger's paperwork on someone's claim is not a degraded mode worth
  having.
