import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimActions } from "./ClaimActions";
import type { Claim } from "./types";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ role: "desk_head" }),
}));

const CLAIM = {
  id: "claim-1",
  status: "DISCHARGE_AUTHORISED",
  patientName: "Rajendra Pawar",
  insurerName: "Star Health",
  billedAmount: "103500.00",
  sanctionedAmount: "103500.00",
  settledAmount: null,
  settledOn: null,
  queriedFrom: null,
} as unknown as Claim;

/*
  The dialog's submit button sits in the footer, outside the <form> it
  names, which is how every dialog on the desk is built. jsdom resolves
  the association (`button.form` is right) but does not carry a click
  on it through to a submit event when the pair is inside a Radix
  portal, so the form is submitted directly here. The handler under
  test is the same one either way.
*/
async function submitDialog() {
  fireEvent.submit(document.getElementById("record-payment")!);
  await screen.findByRole("dialog");
}

function renderActions(claim: Claim) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClaimActions claim={claim} />
    </QueryClientProvider>,
  );
}

/*
  Settling is where the money stops moving, and the button did it with
  no money on record -- leaving a claim at SETTLED with no settled
  amount and no date, the one state `db:verify` has always asserted
  against. The API now refuses that, so the button has to collect the
  payment rather than walk the desk into a 422.
*/
describe("marking a claim settled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.patch).mockResolvedValue({} as never);
  });

  it("asks for the payment instead of settling straight away", async () => {
    const user = userEvent.setup();
    renderActions(CLAIM);

    await user.click(screen.getByRole("button", { name: "Mark settled" }));

    // The dialog, not a status write.
    expect(
      await screen.findByRole("button", {
        name: "Record and settle",
      }),
    ).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("records the payment and then the status, in that order", async () => {
    const user = userEvent.setup();
    renderActions(CLAIM);

    await user.click(screen.getByRole("button", { name: "Mark settled" }));
    await user.type(screen.getByLabelText(/Amount received/), "103500");
    await submitDialog();

    const calls = vi.mocked(api.patch).mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      "/claims/claim-1/payment",
      "/claims/claim-1/status",
    ]);
    expect(calls[1]?.[1]).toEqual({ status: "SETTLED" });
  });

  it("settles directly when the money is already on record", async () => {
    // The commoner order -- the insurer pays, the desk catches up with
    // the status later. A second dialog there would be asking for a
    // figure the claim already holds.
    const user = userEvent.setup();
    renderActions({ ...CLAIM, settledAmount: "103500.00" } as Claim);

    await user.click(screen.getByRole("button", { name: "Mark settled" }));

    expect(api.patch).toHaveBeenCalledWith("/claims/claim-1/status", {
      status: "SETTLED",
    });
  });

  it("says so when the payment saved and the status didn't", async () => {
    // The half-done case. Closing on the payment alone would report
    // success for a claim still sitting at Discharge authorised.
    const user = userEvent.setup();
    vi.mocked(api.patch).mockImplementation(((path: string) =>
      path.endsWith("/status")
        ? Promise.reject(new Error("record what the insurer paid first"))
        : Promise.resolve({})) as never);

    renderActions(CLAIM);
    await user.click(screen.getByRole("button", { name: "Mark settled" }));
    await user.type(screen.getByLabelText(/Amount received/), "103500");
    await submitDialog();

    expect(
      await screen.findByText(/Payment saved, but the claim couldn't be/),
    ).toBeInTheDocument();
  });
});
