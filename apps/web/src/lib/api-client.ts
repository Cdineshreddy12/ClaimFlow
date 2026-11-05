import { supabase } from "./supabase-client";

export const API_URL = import.meta.env.VITE_API_URL;
/** Empty in any production build — injected by vite.config.ts, see the note there. */
const DEV_TOKEN =
  (typeof __DEV_TOKEN__ === "string" ? __DEV_TOKEN__ : "") || undefined;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.error ?? body.message ?? res.statusText,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestBlob(path: string): Promise<Blob> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
