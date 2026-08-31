/* Session-less fetch wrapper (direct-payment spec D9): the page is
   public — the link token is the credential, no cookies ride along.
   Base resolution mirrors the admin's (lib/base.ts): the
   dev server never proxies the API; deployed builds get VITE_API_URL
   from the workflow (CICD.md). */

export const DEV_API_ORIGIN = "http://localhost:8787";

export function resolveApiBase(env: { VITE_API_URL?: string; MODE?: string }): string {
  return env.VITE_API_URL ?? (env.MODE === "development" ? DEV_API_ORIGIN : "");
}

export const API_BASE = resolveApiBase(import.meta.env);

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    ...init,
  });
  const json = (await res.json()) as {
    success: boolean;
    data: T;
    error?: { code?: string };
  };
  if (!res.ok || !json.success) {
    throw new ApiError(json.error?.code ?? "UNKNOWN_ERROR", res.status);
  }
  return json.data;
}
