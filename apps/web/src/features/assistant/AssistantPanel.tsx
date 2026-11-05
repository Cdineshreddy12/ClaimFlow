import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Sound } from "reicon-react";
import { Button } from "../../components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTrigger,
} from "../../components/ui/drawer";
import { Textarea } from "../../components/ui/textarea";
import {
  streamChat,
  useAssistantStatus,
  useConversation,
  useConversations,
  useDeleteConversation,
  usePendingAttachments,
  uploadAttachment,
} from "./api";
import { AttachmentChip, type StagedFile } from "./AttachmentChip";
import { MatchTable } from "./MatchTable";
import { ProposalCard } from "./ProposalCard";
import type { AssistantAttachment, ChatTurn } from "./types";

/**
 * Deferred because it is the one expensive thing here: a real markdown
 * parser costs ~60kB gzipped, and it is dead weight on every dashboard
 * and claim page that never opens the drawer. Until it arrives the
 * reply renders as plain text — which is exactly what it was before —
 * so the fallback is the old behaviour rather than a spinner.
 */
const AssistantMarkdown = lazy(() =>
  import("./AssistantMarkdown").then((m) => ({ default: m.AssistantMarkdown })),
);

/**
 * The desk assistant, on every screen.
 *
 * A right-hand drawer over the page rather than a route of its own,
 * following the b2b-crm's record panels. The work it does is
 * interstitial — a ward hands over a scan while someone is mid-claim —
 * and making them navigate away to deal with it is the interruption,
 * not the help. The claim they were reading is still there when the
 * drawer closes, with no history entry to back out of.
 *
 * Nothing it says is a record of anything. The conversation lives in
 * this component's state and dies with the tab — what survives is what
 * a human approved, written by the ordinary services. See
 * docs/adr/0005.
 */
export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const { data: status } = useAssistantStatus();
  const { data: pending } = usePendingAttachments(open);

  const pendingCount = pending?.length ?? 0;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label="Desk assistant"
          className="fixed bottom-5 right-5 z-40 flex size-12 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-primary text-white shadow-[0_6px_20px_rgba(0,0,0,0.22)] hover:bg-primary-hover [&_svg]:size-5"
        >
          <Sound aria-hidden focusable="false" />
          {/* A dot, not a count. How many files are unfiled is a
              number nobody acts on from here — the useful signal is
              only that something is waiting, and the exact figure is
              in the panel when they open it. */}
          {pendingCount > 0 && !open ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-primary bg-critical"
            />
          ) : null}
        </button>
      </DrawerTrigger>

      {/* Mounted only while open so the conversation starts fresh each
          time — nothing persists a chat, and a half-finished exchange
          from an hour ago is worse than a clean one. */}
      {open ? (
        <AssistantBody
          available={status?.available ?? true}
          pending={pending ?? []}
        />
      ) : null}
    </Drawer>
  );
}

/**
 * What a read tool is doing, in the desk's words.
 *
 * The tool name is the honest thing to key off — it is exactly what is
 * running — but "get_sla_watch" is not a sentence. Anything unmapped
 * falls through to a generic line rather than leaking an identifier.
 */
/** Openers worth one tap, each exercising a different read tool. */
const SUGGESTIONS = [
  "What should I do next?",
  "Which claims are against the clock?",
  "What's missing on CLM-0001?",
];

const TOOL_LABEL: Record<string, string> = {
  search_claims: "Looking through the claims…",
  get_claim: "Reading the claim…",
  list_documents: "Checking what's already on file…",
  get_receivables_ageing: "Adding up what's owed…",
  get_deduction_summary: "Adding up what was deducted…",
  get_insurer_turnaround: "Measuring the insurers…",
  get_claim_financials: "Working out the money…",
  get_appeal_worklist: "Looking for recoverable money…",
  list_queries: "Checking the query inbox…",
  get_sla_watch: "Checking the clock…",
  get_deduction_risk: "Looking at what this insurer usually cuts…",
  run_presubmission_review: "Reviewing the form…",
};

/** Small, quiet, and motion-safe — this sits next to a line of text. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full border-2 border-line-strong border-t-transparent motion-safe:animate-spin motion-reduce:[animation-duration:2.4s]"
    />
  );
}

function AssistantBody({
  available,
  pending,
}: {
  available: boolean;
  pending: AssistantAttachment[];
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, unknown>>({});
  /** The reply as it arrives, before it becomes a turn. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const conversations = useConversations(showHistory);
  const history = useConversation(openHistoryId);
  const removeConversation = useDeleteConversation();

  // Replaces the panel's contents when a past conversation is opened.
  // Read-only until the next message, which continues it.
  useEffect(() => {
    if (!history.data) return;
    setTurns(history.data.turns);
    setResolved(history.data.resolvedProposals ?? {});
    setConversationId(history.data.id);
    setShowHistory(false);
    setOpenHistoryId(null);
  }, [history.data]);

  // Everything the cards might need to render: what was staged this
  // session plus whatever was left unfiled from a previous one.
  const known = [
    ...pending,
    ...staged.flatMap((f) => (f.attachment ? [f.attachment] : [])),
  ].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);

  // Files still uploading or still being read aren't ready to talk
  // about, so the send button waits for them rather than sending a
  // message that references half a batch.
  const stagedReady = staged.filter((f) => f.state === "done" && f.attachment);
  const stagedBusy = staged.some(
    (f) => f.state === "uploading" || f.state === "reading",
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, streaming, staged, sending]);

  function patchStaged(key: string, patch: Partial<StagedFile>) {
    setStaged((s) => s.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  /**
   * Each file gets its own row and its own fate.
   *
   * In parallel, because a desk drops five scans at once and reading
   * them one after another makes the fifth wait for four OCR passes it
   * has nothing to do with. One failure marks its own chip and leaves
   * the rest alone.
   */
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const batch = Array.from(files).map((file) => ({
      file,
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setStaged((s) => [
      ...s,
      ...batch.map(({ file, key }) => ({
        key,
        fileName: file.name,
        state: "uploading" as const,
        progress: 0,
      })),
    ]);

    await Promise.all(
      batch.map(async ({ file, key }) => {
        try {
          const attachment = await uploadAttachment(file, (stage) =>
            patchStaged(key, stage),
          );
          patchStaged(key, { state: "done", attachment });
        } catch (err) {
          patchStaged(key, {
            state: "failed",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }),
    );
    queryClient.invalidateQueries({ queryKey: ["assistant", "attachments"] });
  }

  async function send() {
    const message = draft.trim();
    const attachmentIds = stagedReady.map((f) => f.attachment!.id);
    if (!message && attachmentIds.length === 0) return;

    setTurns((t) => [
      ...t,
      {
        id: `u${t.length}`,
        role: "user",
        text: message,
        attachments: stagedReady.map((f) => ({
          id: f.attachment!.id,
          fileName: f.fileName,
        })),
      },
    ]);
    setDraft("");
    setStaged([]);
    setSending(true);
    // Empty rather than null from the off: the bubble should appear the
    // moment the request goes out, not when the first token lands.
    setStreaming("");

    try {
      const result = await streamChat(
        {
          ...(conversationId ? { conversationId } : {}),
          message,
          attachmentIds,
        },
        {
          onText: (delta) => setStreaming((s) => (s ?? "") + delta),
          onTool: (name) => setDoing(name),
        },
      );
      setConversationId(result.conversationId);
      setTurns((t) => [
        ...t,
        {
          id: `a${t.length}`,
          role: "assistant",
          text: result.reply,
          proposals: result.proposals,
        },
      ]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          id: `a${t.length}`,
          role: "assistant",
          text: "",
          error: err instanceof Error ? err.message : "Something went wrong.",
        },
      ]);
    } finally {
      setSending(false);
      setStreaming(null);
      setDoing(null);
    }
  }

  return (
    <DrawerContent
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <DrawerHeader
        title="Desk assistant"
        description="Drop a scan, or ask about a claim"
      >
        <div className="flex shrink-0 gap-1.5">
          {turns.length > 0 && !showHistory ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                // A new thread, not a cleared one: the old conversation
                // is saved and reachable from History.
                setTurns([]);
                setResolved({});
                setConversationId(null);
              }}
            >
              New
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((h) => !h)}
          >
            {showHistory ? "Back" : "History"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" size="sm" variant="outline">
              Close
            </Button>
          </DrawerClose>
        </div>
      </DrawerHeader>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          {conversations.isLoading ? (
            <div className="text-sm text-ink-faint">Loading…</div>
          ) : null}
          {conversations.data?.length === 0 ? (
            <div className="text-base text-ink-faint">
              Nothing here yet. Conversations are saved as you have them.
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {conversations.data?.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
                  onClick={() => setOpenHistoryId(c.id)}
                >
                  <div className="truncate text-base font-medium text-ink">
                    {c.title}
                  </div>
                  <div className="text-sm text-ink-faint">
                    {new Date(c.updatedAt).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Delete "${c.title}"`}
                  disabled={removeConversation.isPending}
                  onClick={() => removeConversation.mutate(c.id)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scroller}
          className={`flex-1 overflow-y-auto px-4 py-3.5 ${dragging ? "bg-accent-soft" : ""}`}
        >
          {/* The drawer can be most of the screen now; a line of prose
              should not be. Everything sits in a centred column of a
              readable measure, which also gives the tables room. */}
          <div className="mx-auto w-full max-w-[1100px]">
            {!available ? (
              <div className="rounded-md border border-pending bg-pending-bg px-3 py-2.5 text-base">
                Reading documents isn&apos;t configured on this install, so the
                assistant can&apos;t identify claims or answer questions.
                Everything else in the app works as usual.
              </div>
            ) : null}

            {turns.length === 0 && available ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-dashed border-line-strong px-4 py-5 text-center">
                  <div className="text-md font-semibold text-ink">
                    Drop a pile of scans here
                  </div>
                  <div className="mx-auto mt-1 max-w-[42ch] text-base leading-relaxed text-ink-faint">
                    I&apos;ll read each one and work out which claim and slot it
                    belongs to. Nothing is filed until you approve it.
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    Or ask
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setDraft(q)}
                        className="cursor-pointer rounded-full border border-line bg-surface-raised px-2.5 py-1 text-sm text-ink-soft hover:border-line-strong hover:text-ink"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* The count on its own was a nag with nothing behind it.
                  Showing the files means the backlog can be dealt with
                  from where it is announced. */}
                {pending.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      Still unfiled from earlier
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {pending.map((a) => (
                        <AttachmentChip
                          key={a.id}
                          file={{
                            key: a.id,
                            fileName: a.fileName,
                            state: "done",
                            attachment: a,
                          }}
                        />
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        // Stages them as well as asking: the question on
                        // its own sent no attachment ids, so the
                        // assistant was being asked about files it had
                        // not been given.
                        setStaged((s) => [
                          ...s,
                          ...pending
                            .filter((a) => !s.some((f) => f.key === a.id))
                            .map((a) => ({
                              key: a.id,
                              fileName: a.fileName,
                              state: "done" as const,
                              attachment: a,
                            })),
                        ]);
                        setDraft(
                          "Where do these belong? File the ones you're sure about.",
                        );
                      }}
                    >
                      Ask about these
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              {turns.map((turn) => (
                <div key={turn.id}>
                  {turn.role === "user" ? (
                    <div className="flex flex-col gap-1.5">
                      {turn.text ? (
                        <div className="ml-auto w-fit max-w-[85%] rounded-md bg-accent-soft px-3 py-2 text-base text-ink [overflow-wrap:anywhere]">
                          {turn.text}
                        </div>
                      ) : null}
                      {/* What was attached and what it matched, full
                        width — a list of filenames said what arrived
                        and nothing about where any of it goes, which
                        is the only question being asked. */}
                      {turn.attachments?.length ? (
                        <MatchTable
                          attachments={turn.attachments.flatMap((ref) => {
                            const full = known.find((k) => k.id === ref.id);
                            return full ? [full] : [];
                          })}
                        />
                      ) : null}
                    </div>
                  ) : turn.error ? (
                    // In the reply's place, so the question above it does
                    // not sit there looking ignored once the next message
                    // is sent.
                    <div className="max-w-[92%] rounded-md border border-critical bg-critical-bg px-3 py-2 text-base font-medium text-critical">
                      {turn.error}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="max-w-[92%]">
                        <Suspense
                          fallback={
                            <div className="whitespace-pre-wrap text-base leading-relaxed text-ink [overflow-wrap:anywhere]">
                              {turn.text}
                            </div>
                          }
                        >
                          <AssistantMarkdown>{turn.text}</AssistantMarkdown>
                        </Suspense>
                      </div>
                      {turn.proposals?.map((p) => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          attachments={known}
                          conversationId={conversationId}
                          alreadyApproved={Boolean(resolved[p.id])}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {streaming !== null ? (
                <div className="max-w-[92%]">
                  {streaming ? (
                    <Suspense
                      fallback={
                        <div className="whitespace-pre-wrap text-base leading-relaxed text-ink [overflow-wrap:anywhere]">
                          {streaming}
                        </div>
                      }
                    >
                      <AssistantMarkdown>{streaming}</AssistantMarkdown>
                    </Suspense>
                  ) : null}
                  {/* Shown only until the first token: once words are
                  arriving, a status line underneath them is noise. */}
                  {!streaming ? (
                    <div className="flex items-center gap-2 text-sm text-ink-faint">
                      <Spinner />
                      {doing ? (TOOL_LABEL[doing] ?? "Looking…") : "Thinking…"}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="mx-auto w-full max-w-[1100px]">
          {staged.length > 0 ? (
            <div className="mb-2 grid gap-1.5 sm:grid-cols-2">
              {staged.map((f) => (
                <AttachmentChip
                  key={f.key}
                  file={f}
                  onRemove={() =>
                    setStaged((s) => s.filter((x) => x.key !== f.key))
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-1.5">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Attach files"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip aria-hidden focusable="false" />
            </Button>
            <Textarea
              rows={1}
              value={draft}
              placeholder="Ask, or drop a file…"
              aria-label="Message the assistant"
              disabled={!available}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — a desk types
                // one sentence and hits enter.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="max-h-28 min-h-9 flex-1 resize-y py-1.5"
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send"
              disabled={
                !available ||
                sending ||
                stagedBusy ||
                (!draft.trim() && stagedReady.length === 0)
              }
              onClick={() => void send()}
            >
              <Send aria-hidden focusable="false" />
            </Button>
          </div>
        </div>
      </div>
    </DrawerContent>
  );
}
