import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders the formatting the assistant actually writes", () => {
    render(
      <AssistantMarkdown>
        {"**CLM-0001** is missing:\n\n- Policy / e-card copy\n- Photo ID proof"}
      </AssistantMarkdown>,
    );

    // The reason this exists: the model writes lists whether or not
    // anything renders them, and as plain text they arrived as a wall
    // of asterisks.
    expect(screen.getByText("CLM-0001").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Photo ID proof")).toBeInTheDocument();
  });

  it("puts a table in its own scroller rather than widening the drawer", () => {
    const { container } = render(
      <AssistantMarkdown>
        {"| Claim | Due |\n| --- | --- |\n| CLM-0001 | today |"}
      </AssistantMarkdown>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    // The panel is a narrow column and a table is the one thing that
    // cannot be made to fit it.
    expect(container.querySelector(".overflow-x-auto")).toBeTruthy();
  });

  /**
   * The security rule, and the one worth a test rather than a comment:
   * this renders model output into a page holding patient data, so raw
   * HTML stays off. react-markdown's default is to ignore it; this
   * fails the day someone adds rehype-raw for a nicer bullet.
   */
  it("does not render raw HTML from the model", () => {
    const { container } = render(
      <AssistantMarkdown>
        {'Before <img src=x onerror="alert(1)"> after'}
      </AssistantMarkdown>,
    );

    // No element, and nothing with a handler on it. The markup comes
    // through escaped and renders as the literal characters — which is
    // the honest thing to show, since the model did write them.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(
      screen.getByText(/Before <img src=x onerror="alert\(1\)"> after/),
    ).toBeInTheDocument();
  });

  /**
   * The model lists filenames constantly — in tables, in bullets — and
   * every one of them used to be a dead string.
   */
  it("makes a filename the model linked openable", () => {
    render(
      <AssistantMarkdown>
        {"| File |\n| --- |\n| [scan_0017.jpg](document:c1/d1) |"}
      </AssistantMarkdown>,
    );

    // react-markdown's default transform drops unknown schemes, which
    // would have silently turned this into a dead link.
    expect(
      screen.getByRole("button", { name: "scan_0017.jpg" }),
    ).toBeInTheDocument();
  });

  it("turns a chart block into a chart", () => {
    render(
      <AssistantMarkdown>
        {
          '```chart\n{"type":"bar","title":"Leakage","unit":"currency","data":[{"label":"Missing document","value":42000}]}\n```'
        }
      </AssistantMarkdown>,
    );

    expect(screen.getByText("Leakage")).toBeInTheDocument();
    expect(screen.getByText("₹42,000")).toBeInTheDocument();
  });

  it("leaves a malformed chart as a readable code block", () => {
    render(
      <AssistantMarkdown>
        {"```chart\n{not json at all}\n```"}
      </AssistantMarkdown>,
    );

    // Falling back to text beats rendering nothing: the numbers the
    // model was trying to show are still on screen.
    expect(screen.getByText(/not json at all/)).toBeInTheDocument();
  });

  it("sends links away from the session rather than opening them in it", () => {
    render(
      <AssistantMarkdown>
        {"[the portal](https://example.com)"}
      </AssistantMarkdown>,
    );

    const link = screen.getByRole("link", { name: "the portal" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
