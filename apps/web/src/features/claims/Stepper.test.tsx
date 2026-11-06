import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("marks a settled claim done rather than in progress", () => {
    // Settled is the end of the line. Treating it as the "current" step
    // put an amber "In progress" under "Settled" — the stepper saying
    // there was work left on a claim that is closed and paid.
    render(<Stepper status="SETTLED" />);

    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.getAllByText("Done")).toHaveLength(5);
  });

  it("still shows the live step as in progress", () => {
    render(<Stepper status="PRE_AUTH_SENT" />);

    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("names who is holding a queried claim instead of saying 'in progress'", () => {
    render(<Stepper status="QUERY_RAISED" />);

    expect(screen.getByText("Waiting on us")).toBeInTheDocument();
  });

  it("replaces the whole track for a rejected claim", () => {
    // Nothing to be partway through — the insurer closed it.
    render(<Stepper status="REJECTED" />);

    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByText("In progress")).toBeNull();
  });
});
