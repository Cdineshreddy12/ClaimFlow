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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      // Stand-in for real login — see .env.example's VITE_DEV_TOKEN comment.
      Authorization: `Bearer ${DEV_TOKEN}`,
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
