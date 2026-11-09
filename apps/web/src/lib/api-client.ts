import { supabase } from "./supabase-client";

export const API_URL = import.meta.env.VITE_API_URL;
/** Empty in any production build — injected by vite.config.ts, see the note there. */
const DEV_TOKEN =
  (typeof __DEV_TOKEN__ === "string" ? __DEV_TOKEN__ : "") || undefined;

/**
 * How long any one call may hang before it is treated as failed.
 *
 * Without this a request that never comes back never fails either:
 * `fetch` has no default timeout, so a server restart, a dropped
 * connection or a sleeping laptop left a mutation pending forever and
 * its button disabled with no error and no way out — the desk's only
 * recovery was to reload the page and hope.
 *
 * Generous because the AI calls are genuinely slow: reading a form off
 * four documents takes the better part of twenty seconds on a good
 * day. This is the "something is wrong" threshold, not a target.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Both callers want the same bounded signal, including the blob path. */
function withTimeout(init?: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

/** A timeout surfaces as a TimeoutError, which says nothing to a desk. */
function asApiError(err: unknown): never {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    throw new ApiError(0, "The server didn't respond. Try that again.");
  }
  if (err instanceof TypeError) {
    throw new ApiError(0, "Couldn't reach the server. Check your connection.");
  }
  throw err;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Per-field complaints, when the endpoint sent any.
     *
     * A 422 from a form-shaped endpoint names which answer is wrong.
     * Flattening that to one sentence sends the reader hunting through
     * twelve inputs for the one it meant.
     */
    public fields?: { fieldKey: string; message: string }[],
  ) {
    super(message);
  }
}

/** In local dev the token wins — it's an explicit opt-in to skip signing in, not a silent fallback that should surprise a real session. */
async function getAuthToken(): Promise<string | null> {
  if (DEV_TOKEN) return DEV_TOKEN;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * The Authorization header, for callers that can't go through `request`
 * — the assistant's chat stream reads a response body itself rather
 * than parsing JSON, so it builds its own fetch.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...withTimeout(init),
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  }).catch(asApiError);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.error ?? body.message ?? res.statusText,
      Array.isArray(body.fields) ? body.fields : undefined,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestBlob(path: string): Promise<Blob> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...withTimeout(),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(asApiError);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** For endpoints that return a file — a bearer header rules out a plain link. */
  getBlob: (path: string) => requestBlob(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(
      path,
      body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : { method: "POST" },
    ),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(
      path,
      body !== undefined
        ? { method: "PATCH", body: JSON.stringify(body) }
        : { method: "PATCH" },
    ),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
