import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "./AssistantPanel";
import * as assistantApi from "./api";
import type { AssistantAttachment } from "./types";

vi.mock("./api");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function attachment(
  overrides: Partial<AssistantAttachment> = {},
): AssistantAttachment {
  return {
    id: "att-1",
    fileName: "IMG_0423.jpg",
    contentType: "image/jpeg",
    suggestedClaimId: "claim-1",
    suggestedSlot: "Treating doctor's note",
    claimConfidence: "0.970",
    slotConfidence: "0.980",
    recognitionReason: "Names Rajendra Pawar.",
    ocrConfidence: "0.990",
    filedAt: null,
    dismissedAt: null,
    createdAt: "2026-11-05T12:00:00.000Z",
    suggestedClaim: {
      id: "claim-1",
      reference: "CLM-0001",
      patientName: "Rajendra Pawar",
      procedureName: "Gall bladder removal",
      checklistSlots: ["Treating doctor's note"],
    },
    ...overrides,
  };
}

/** react-query hooks are mocked wholesale; these are the shapes they return. */
function stubHooks(pending: AssistantAttachment[] = []) {
  vi.mocked(assistantApi.useAssistantStatus).mockReturnValue({
    data: { available: true },
  } as never);
  vi.mocked(assistantApi.usePendingAttachments).mockReturnValue({
    data: pending,
  } as never);
  vi.mocked(assistantApi.useConversations).mockReturnValue({
    data: [],
    isLoading: false,
  } as never);
  vi.mocked(assistantApi.useConversation).mockReturnValue({
    data: undefined,
  } as never);
  vi.mocked(assistantApi.useDeleteConversation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
}

async function openPanel() {
  render(<AssistantPanel />, { wrapper });
  await userEvent.click(screen.getByRole("button", { name: "Desk assistant" }));
}

describe("AssistantPanel", () => {
  beforeEach(() => {
    stubHooks();
  });

  it("opens on the launcher and offers something to ask", async () => {
    await openPanel();

    expect(screen.getByText("Desk assistant")).toBeInTheDocument();
    expect(screen.getByText(/Drop a pile of scans here/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What should I do next?" }),
    ).toBeInTheDocument();
  });

  it("loads a suggestion into the box instead of sending it blind", async () => {
    await openPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "What should I do next?" }),
    );

    expect(
      screen.getByRole("textbox", { name: "Message the assistant" }),
    ).toHaveValue("What should I do next?");
    expect(assistantApi.streamChat).not.toHaveBeenCalled();
  });

  /**
   * The count on its own was a nag with nothing behind it — the files
   * it refers to have to be reachable from where it is announced.
   */
  it("shows last session's unfiled files, not just how many there were", async () => {
    stubHooks([attachment()]);
    await openPanel();

    expect(screen.getByText(/Still unfiled from earlier/)).toBeInTheDocument();
    expect(screen.getByText("IMG_0423.jpg")).toBeInTheDocument();
    // Decorated, so the chip can say what it matched rather than
    // claiming it didn't.
    expect(screen.getByText("CLM-0001")).toBeInTheDocument();
  });

  describe("sending", () => {
    it("streams the reply in as it arrives, then settles into the turn", async () => {
      vi.mocked(assistantApi.streamChat).mockImplementation(
        async (_body, handlers) => {
          handlers.onTool("get_sla_watch");
          handlers.onText("Nothing on ");
          handlers.onText("the clock.");
          return {
            conversationId: "conv-1",
            reply: "Nothing on the clock.",
            proposals: [],
          };
        },
      );
      await openPanel();

      const box = screen.getByRole("textbox", {
        name: "Message the assistant",
      });
      await userEvent.type(box, "what should i do next");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));

      expect(
        await screen.findByText("Nothing on the clock."),
      ).toBeInTheDocument();
      expect(assistantApi.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ message: "what should i do next" }),
        expect.anything(),
      );
    });

    it("continues the same conversation on the next message", async () => {
      vi.mocked(assistantApi.streamChat).mockResolvedValue({
        conversationId: "conv-1",
        reply: "ok",
        proposals: [],
      });
      await openPanel();

      const box = screen.getByRole("textbox", {
        name: "Message the assistant",
      });
      await userEvent.type(box, "first");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("ok");

      await userEvent.type(box, "second");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(assistantApi.streamChat).toHaveBeenLastCalledWith(
          expect.objectContaining({
            conversationId: "conv-1",
            message: "second",
          }),
          expect.anything(),
        ),
      );
    });

    /**
     * A failure used to be one transient line at the bottom that
     * vanished on the next send, leaving the question above it looking
     * ignored.
     */
    it("leaves the failure where the reply would have been", async () => {
      vi.mocked(assistantApi.streamChat).mockRejectedValue(
        new Error("The assistant didn't answer (503)."),
      );
      await openPanel();

      const box = screen.getByRole("textbox", {
        name: "Message the assistant",
      });
      await userEvent.type(box, "hello");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));

      expect(
        await screen.findByText("The assistant didn't answer (503)."),
      ).toBeInTheDocument();
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    it("shows what each attached file matched as a table, not a list of names", async () => {
      stubHooks([attachment()]);
      vi.mocked(assistantApi.streamChat).mockResolvedValue({
        conversationId: "conv-1",
        reply: "Filing that one.",
        proposals: [],
      });
      await openPanel();

      // Dropped earlier, so it is in `pending` and therefore `known` —
      // the table is built from the decorated attachment, not from the
      // bare {id, fileName} the turn carries.
      await userEvent.click(
        screen.getByRole("button", { name: "Ask about these" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("Filing that one.");

      const table = screen.getByRole("table");
      expect(within(table).getByText("CLM-0001")).toBeInTheDocument();
      expect(within(table).getByText("97%")).toBeInTheDocument();
      expect(
        within(table).getByText("Treating doctor's note"),
      ).toBeInTheDocument();
    });

    it("won't send an empty message", async () => {
      await openPanel();

      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });
  });

  it("says so plainly when the assistant isn't configured", async () => {
    stubHooks();
    vi.mocked(assistantApi.useAssistantStatus).mockReturnValue({
      data: { available: false },
    } as never);
    await openPanel();

    expect(
      screen.getByText(/Reading documents isn't configured/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
