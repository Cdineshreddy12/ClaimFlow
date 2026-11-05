import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { API_URL, authHeader } from "../../lib/api-client";
import type {
  AssistantAttachment,
  ChatResult,
  Conversation,
  ConversationSummary,
  Proposal,
} from "./types";

export function useAssistantStatus() {
  return useQuery({
    queryKey: ["assistant", "status"],
    queryFn: () => api.get<{ available: boolean }>("/assistant/status"),
    staleTime: 5 * 60_000,
  });
}

/** Files dropped but not yet filed or thrown away — the panel's backlog. */
export function usePendingAttachments(enabled: boolean) {
  return useQuery({
    queryKey: ["assistant", "attachments"],
    queryFn: () => api.get<AssistantAttachment[]>("/assistant/attachments"),
    enabled,
  });
}

/**
 * Same two-step upload as a claim document — pre-signed URL, bytes
 * straight to S3, then register (docs/adr/0003). The difference is only
 * that there is no claim in the path yet, which is the point.
 *
 * Registering is where the reading happens, so this call is slow on
 * purpose: by the time it resolves, the file has been through OCR, the
 * recogniser and the classifier, and comes back knowing where it thinks
 * it belongs.
 */
/**
 * Uploads to S3 with progress.
 *
 * XHR rather than fetch, for the one thing fetch still cannot do:
 * report how far a request body has got. A phone photo of a policy card
 * on a hospital's connection is a real wait, and a panel that shows
 * nothing until it finishes looks hung.
 */
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage refused the file (${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Couldn't reach storage."));
    xhr.send(file);
  });
}

/**
 * The full upload: a pre-signed URL, the bytes straight to S3, then
 * registration — which is where OCR, the recogniser and the classifier
 * run, so it is slow on purpose and reported as its own step.
 */
export async function uploadAttachment(
  file: File,
  onStage: (stage: {
    state: "uploading" | "reading";
    progress?: number;
  }) => void,
): Promise<AssistantAttachment> {
  const contentType = file.type || "application/octet-stream";
  const { uploadUrl, key } = await api.post<{
    uploadUrl: string;
    key: string;
  }>("/assistant/attachments/upload-url", {
    fileName: file.name,
    contentType,
  });

  onStage({ state: "uploading", progress: 0 });
  await putWithProgress(uploadUrl, file, contentType, (progress) =>
    onStage({ state: "uploading", progress }),
  );

  onStage({ state: "reading" });
  return api.post<AssistantAttachment>("/assistant/attachments", {
    key,
    fileName: file.name,
    contentType,
  });
}

export function useConversations(enabled: boolean) {
  return useQuery({
    queryKey: ["assistant", "conversations"],
    queryFn: () => api.get<ConversationSummary[]>("/assistant/conversations"),
    enabled,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["assistant", "conversations", id],
    queryFn: () => api.get<Conversation>(`/assistant/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/assistant/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assistant", "conversations"],
      });
    },
  });
}

/**
 * One turn, read as it arrives.
 *
 * `fetch` rather than `EventSource`: this is a POST carrying a bearer
 * token and a body, and EventSource can do neither. The parsing below
 * is the small price — SSE frames are blank-line separated, which is
 * the whole format.
 */
export async function streamChat(
  body: { conversationId?: string; message: string; attachmentIds: string[] },
  handlers: {
    onText: (delta: string) => void;
    onTool: (name: string) => void;
    signal?: AbortSignal;
  },
): Promise<ChatResult> {
  const res = await fetch(`${API_URL}/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
    },
    body: JSON.stringify(body),
    ...(handlers.signal ? { signal: handlers.signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`The assistant didn't answer (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResult | null = null;
  let failure: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // A frame ends at a blank line; anything after the last one is a
    // partial frame and waits for the next chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === "text") handlers.onText(data.text as string);
      else if (event === "tool") handlers.onTool(data.name as string);
      else if (event === "done") result = data as ChatResult;
      else if (event === "failed") failure = data.error as string;
    }
  }

  // Errors arrive in the stream because the status line is long gone by
  // the time anything can go wrong.
  if (failure) throw new Error(failure);
  if (!result) throw new Error("The assistant stopped mid-answer.");
  return result;
}

/**
 * The only call that changes anything.
 *
 * It carries the proposal's payload rather than its id, because the
 * desk can correct a card before approving it — the slot, the claim —
 * and what executes has to be what they actually agreed to.
 */
export function useApproveProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposal: {
      kind: Proposal["kind"];
      input: Proposal["input"];
      conversationId?: string | null | undefined;
      proposalId?: string | undefined;
    }) =>
      api.post<unknown>("/assistant/proposals/approve", {
        kind: proposal.kind,
        input: proposal.input,
        // So the card can be marked spent and not offered again when
        // the conversation is reopened.
        ...(proposal.conversationId
          ? { conversationId: proposal.conversationId }
          : {}),
        ...(proposal.proposalId ? { proposalId: proposal.proposalId } : {}),
      }),
    onSuccess: () => {
      // A filing lands on a claim's documents and its gaps; a logged
      // query lands in the inbox. Cheaper to refetch the lot than to
      // teach this which screens a given proposal touched.
      queryClient.invalidateQueries({ queryKey: ["assistant", "attachments"] });
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["queries"] });
    },
  });
}

export function useDismissAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/assistant/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assistant", "attachments"] });
    },
  });
}
