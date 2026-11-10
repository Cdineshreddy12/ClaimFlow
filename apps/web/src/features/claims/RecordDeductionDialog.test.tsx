import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordDeductionDialog } from "./RecordDeductionDialog";
import type { Claim } from "./types";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const CLAIM = {
  id: "claim-1",
  patientName: "Rajendra Pawar",
  insurerName: "Star Health",
  billedAmount: "90000.00",
  settledAmount: "5000.00",
} as unknown as Claim;

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecordDeductionDialog claim={CLAIM} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

/*
  The deduction ceiling is enforced on the server, so the only thing
  the desk ever sees of it is this dialog. It used to replace the
  server's text with "Couldn't record that deduction", which threw away
  both figures and left them retyping the same amount.

  The refusal also rejected out of an async submit handler with nothing
  catching it — an unhandled rejection on every failed save. Vitest
  fails a run on those, so this test holds that shut as well as the
  message.
*/
describe("a deduction the server refuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockRejectedValue(
      new Error(
        "deductions would come to 9,00,000, more than the 90,000 billed",
      ),
    );
  });

  it("shows what the server said, and keeps the dialog open", async () => {
    const onOpenChange = renderDialog();

    // The amount arrives pre-filled from bill minus paid; the reason
    // is the one thing the desk has to choose.
    await userEvent.click(screen.getByRole("combobox", { name: "Reason" }));
    await userEvent.click(
      screen.getByRole("option", { name: "Missing document" }),
    );

    // The footer button lives outside the <form> it names, which jsdom
    // does not carry a click across — see ClaimActions.test.tsx.
    fireEvent.submit(document.getElementById("record-deduction")!);

    expect(
      await screen.findByText(/more than the 90,000 billed/),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
