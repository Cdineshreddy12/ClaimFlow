import { describe, expect, it } from "vitest";
import { emailSentAt } from "./email-date.js";

const NOW = new Date("2026-11-06T10:19:00Z");

describe("emailSentAt", () => {
  it("reads an RFC 5322 Date header, timezone and all", () => {
    const sent = emailSentAt(
      ["From: preauth@tpa.in", "Date: Thu, 6 Nov 2026 11:42:18 +0530", ""].join(
        "\n",
      ),
      NOW,
    );
    // 11:42 IST is 06:12 UTC — four hours before the paste, which is
    // exactly the window the desk was being given for free.
    expect(sent?.toISOString()).toBe("2026-11-06T06:12:18.000Z");
  });

  it("reads Outlook's Sent: header too", () => {
    const sent = emailSentAt("Sent: 5 November 2026 09:30:00 +0530", NOW);
    expect(sent?.getUTCDate()).toBe(5);
  });

  /*
    Every test above hands the parser an explicit +0530, which is why
    this went unnoticed: Outlook's Sent: header has no timezone at all,
    and `new Date` then reads it as the server's local time. In the
    deployed container that is UTC, so a TPA's 11:20 became 11:20Z and
    every pasted 24-hour deadline landed five and a half hours late.

    Asserted against an absolute instant and run under a UTC clock,
    because a test that inherits the host's timezone cannot see this.
  */
  it("reads a bare Outlook header on the hospital's clock", () => {
    const sent = emailSentAt("Sent: Wednesday, 4 November 2026 11:20", NOW);
    // 11:20 IST is 05:50 UTC — not 11:20 UTC.
    expect(sent?.toISOString()).toBe("2026-11-04T05:50:00.000Z");
  });

  it("leaves a header that names its own zone alone", () => {
    // Already unambiguous: adding an offset would move it.
    expect(
      emailSentAt("Date: Wed, 4 Nov 2026 11:20:00 GMT", NOW)?.toISOString(),
    ).toBe("2026-11-04T11:20:00.000Z");
    expect(
      emailSentAt("Date: Wed, 4 Nov 2026 11:20:00 -0500", NOW)?.toISOString(),
    ).toBe("2026-11-04T16:20:00.000Z");
  });

  it("takes the topmost email in a quoted thread", () => {
    // A forwarded chain runs newest-first. The deadline belongs to the
    // mail that just landed, not the one it quotes underneath.
    const sent = emailSentAt(
      [
        "Date: Thu, 6 Nov 2026 11:42:18 +0530",
        "",
        "Reminder, see below.",
        "",
        "> Date: Mon, 2 Nov 2026 09:00:00 +0530",
        "> Original request.",
      ].join("\n"),
      NOW,
    );
    expect(sent?.getUTCDate()).toBe(6);
  });

  it("returns null when the paste has no headers at all", () => {
    // Someone pasted only the body. Falling back to now is right here:
    // the email is presumably fresh, and inventing a date would be worse.
    expect(emailSentAt("Please send the discharge summary.", NOW)).toBeNull();
  });

  it("ignores a date it cannot parse", () => {
    expect(emailSentAt("Date: sometime last week", NOW)).toBeNull();
  });

  it("ignores a header dated well into the future", () => {
    // Their clock, not a real send time. Small skew is tolerated.
    expect(
      emailSentAt("Date: Fri, 20 Nov 2026 09:00:00 +0530", NOW),
    ).toBeNull();
    expect(
      emailSentAt("Date: Fri, 6 Nov 2026 20:00:00 +0530", NOW),
    ).not.toBeNull();
  });

  it("ignores a header older than a year, and keeps a stale-but-real one", () => {
    // A genuinely old email anchors correctly and shows as overdue —
    // that is the truth. A 1970 misparse is not.
    expect(emailSentAt("Date: Thu, 1 Jan 1970 00:00:00 +0000", NOW)).toBeNull();
    expect(
      emailSentAt("Date: Mon, 5 Oct 2026 09:00:00 +0530", NOW)?.getUTCMonth(),
    ).toBe(9);
  });

  it("falls through a junk header to a good one further down", () => {
    const sent = emailSentAt(
      ["Date: not a date", "Date: Thu, 6 Nov 2026 11:42:18 +0530"].join("\n"),
      NOW,
    );
    expect(sent?.toISOString()).toBe("2026-11-06T06:12:18.000Z");
  });

  it("is not fooled by the word 'date' mid-sentence", () => {
    expect(
      emailSentAt("Please confirm the date: 6 Nov 2026 for surgery.", NOW),
    ).toBeNull();
  });
});
