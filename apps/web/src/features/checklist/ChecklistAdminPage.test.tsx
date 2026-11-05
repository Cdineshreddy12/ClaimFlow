import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { InsurersAdminCard } from "../insurers/InsurersAdminCard";
import * as insurersApi from "../insurers/api";

vi.mock("../insurers/api");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stub() {
  vi.mocked(insurersApi.useInsurers).mockReturnValue({
    data: [
      {
        id: "i1",
        name: "Company B",
        type: "tpa",
        code: null,
        contactEmail: null,
        isActive: true,
        claimCount: 3,
        ruleCount: 6,
      },
      {
        id: "i2",
        name: "Company C",
        type: "insurer",
        code: null,
        contactEmail: null,
        isActive: true,
        claimCount: 1,
        ruleCount: 7,
      },
    ],
    isLoading: false,
    isError: false,
  } as never);
  for (const hook of [
    "useCreateInsurer",
    "useUpdateInsurer",
    "useDeleteInsurer",
    "useSetInsurerActive",
  ] as const) {
    vi.mocked(insurersApi[hook]).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as never);
  }
}

describe("InsurersAdminCard, inside the merged tab", () => {
  /**
   * The merge's whole point: the list and the rules editor are one job,
   * so picking an insurer from the list is how you reach its rules —
   * rather than choosing from a dropdown on one tab while the list of
   * insurers sat on another.
   */
  it("picks an insurer for the rules editor above", async () => {
    stub();
    const onSelect = vi.fn();
    render(<InsurersAdminCard selectedId="i1" onSelect={onSelect} />, {
      wrapper,
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Company C" }));

    expect(onSelect).toHaveBeenCalledWith("i2");
  });

  it("stays a plain list when nothing is listening", () => {
    stub();
    render(<InsurersAdminCard />, { wrapper });

    // Used on its own it must not advertise an interaction that leads
    // nowhere.
    expect(
      screen.queryByRole("button", { name: "Company C" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Company C")).toBeInTheDocument();
  });
});
