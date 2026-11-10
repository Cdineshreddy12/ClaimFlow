import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import { signIn } from "./api";

vi.mock("./api", () => ({ signIn: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

async function attemptSignIn() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  await user.type(screen.getByLabelText(/Email/i), "desk.exec@example.com");
  // Not a real credential — the point is which message comes back.
  await user.type(screen.getByLabelText(/Password/i), "whatever");
  await user.click(screen.getByRole("button", { name: /Sign in/i }));
}

/** Supabase's shape: a code, and an HTTP status when it reached the server. */
function authError(code: string | undefined, status: number | undefined) {
  return Object.assign(new Error("auth failed"), { code, status });
}

/*
  Every failure was reported as "Incorrect email or password" — a bare
  `catch` with no binding, so the error wasn't merely unhandled, it was
  unreachable. For a mistyped password that's right; for a rate limit
  or a request that never left the browser it is a confident lie, and
  it sends someone to retype a password that was correct the first
  time. Sign-in is also the one screen where there is no other way to
  find out what happened.
*/
describe("what the sign-in screen says went wrong", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blames the credentials only when Supabase did", async () => {
    vi.mocked(signIn).mockRejectedValue(authError("invalid_credentials", 400));
    await attemptSignIn();
    expect(
      await screen.findByText("Incorrect email or password."),
    ).toBeInTheDocument();
  });

  it("names a rate limit instead of blaming the password", async () => {
    vi.mocked(signIn).mockRejectedValue(
      authError("over_request_rate_limit", 429),
    );
    await attemptSignIn();
    expect(
      await screen.findByText(/Too many sign-in attempts/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Incorrect email/)).not.toBeInTheDocument();
  });

  it("says the request never arrived when there is no status at all", async () => {
    // A network failure carries no HTTP status. Retyping cannot help,
    // so the message must not suggest it.
    vi.mocked(signIn).mockRejectedValue(authError(undefined, undefined));
    await attemptSignIn();
    expect(
      await screen.findByText(/Couldn't reach the sign-in service/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Incorrect email/)).not.toBeInTheDocument();
  });

  it("points at the unconfirmed address rather than the password", async () => {
    vi.mocked(signIn).mockRejectedValue(authError("email_not_confirmed", 400));
    await attemptSignIn();
    expect(
      await screen.findByText(/hasn't been confirmed/),
    ).toBeInTheDocument();
  });

  it("stays vague rather than wrong for a failure it doesn't recognise", async () => {
    vi.mocked(signIn).mockRejectedValue(authError("something_new", 500));
    await attemptSignIn();
    expect(await screen.findByText(/Couldn't sign you in/)).toBeInTheDocument();
    expect(screen.queryByText(/Incorrect email/)).not.toBeInTheDocument();
  });
});
