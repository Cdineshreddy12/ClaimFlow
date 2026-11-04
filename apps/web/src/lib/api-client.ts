import { supabase } from "./supabase-client";

const API_URL = import.meta.env.VITE_API_URL;
const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The dev token, when set, always wins — it's an explicit opt-in to skip signing in locally, not a silent fallback that should ever surprise a real logged-in session. */
async function getAuthToken(): Promise<string | null> {
  if (DEV_TOKEN) return DEV_TOKEN;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(
      path,
      body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : { method: "POST" },
    ),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(
      path,
      body !== undefined
        ? { method: "PATCH", body: JSON.stringify(body) }
        : { method: "PATCH" },
    ),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
