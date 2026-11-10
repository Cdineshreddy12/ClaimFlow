import { Link, useRouteError } from "react-router-dom";
import { AppShell } from "./AppShell";
import { Button } from "@/components/ui/button";

/**
 * A wrong address, or a screen that fell over.
 *
 * Without these React Router shows its own developer screen —
 * "Unexpected Application Error! ... Hey developer 👋" — to whoever is
 * at the keyboard, which on this product is a desk executive with a
 * stale bookmark, or anyone who typed an address. It should look like
 * the application it is part of and point back at the work.
 *
 * The nav used to say "Turnaround" over a path of /sla, which made a
 * guessed address a reliable way to land here. That one is fixed; the
 * screen still has to exist, because a settled claim someone bookmarked
 * can be removed and the link outlives it.
 */
export function NotFoundPage() {
  return (
    <AppShell title="Page not found">
      <Shell
        heading="That page isn't here"
        body="The address may be out of date, or the claim may have been removed. Everything the desk does is reachable from the sidebar."
      />
    </AppShell>
  );
}

/**
 * The root error boundary. Unlike the 404 this can fire before the app
 * has a session, so it deliberately avoids the shell — rendering the
 * sidebar inside a failed render is how one broken screen becomes two.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : null;

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <Shell
        heading="Something went wrong on this screen"
        body="Nothing was lost — the claim is saved. Reloading usually clears it."
        detail={detail}
        reload
      />
    </div>
  );
}

function Shell({
  heading,
  body,
  detail,
  reload = false,
}: {
  heading: string;
  body: string;
  detail?: string | null;
  reload?: boolean;
}) {
  return (
    <div className="py-10 text-center">
      <h1 className="text-xl font-semibold -tracking-[0.01em]">{heading}</h1>
      <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-ink-soft">
        {body}
      </p>
      {detail ? (
        // Kept, but set below the recovery: it is for the person who
        // reports the problem, not the person trying to get back to work.
        <p className="mx-auto mt-4 max-w-sm break-words text-sm text-ink-faint">
          {detail}
        </p>
      ) : null}
      <div className="mt-6 flex justify-center gap-2.5">
        {reload ? (
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
        ) : null}
        <Button asChild variant={reload ? "outline" : "primary"}>
          <Link to="/">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
