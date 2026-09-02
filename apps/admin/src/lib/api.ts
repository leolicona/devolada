/* Same envelope-aware fetch wrapper as the PWA (future packages/api-client). */
import { API_BASE as BASE } from "./base";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: { code?: string } };
  if (!res.ok || !json.success) throw new ApiError(json.error?.code ?? "UNKNOWN_ERROR", res.status);
  return json.data;
}

/* Better Auth endpoints (better-auth.spec.md D6): exempt from the
   envelope. Non-2xx throws with Better Auth's error code. */
export async function baPost(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    try {
      const json = (await res.json()) as { code?: string; message?: string };
      code = json.code ?? json.message ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, res.status);
  }
}

/* Same door, when the answer matters (accept-invitation names the
   organization the person just joined). */
export async function baPostJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    try {
      const json = (await res.json()) as { code?: string; message?: string };
      code = json.code ?? json.message ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, res.status);
  }
  return (await res.json()) as T;
}

/* Better Auth GET endpoints (get-session, organization/list): raw JSON,
   no envelope; a session-less get-session answers `null`. */
export async function baGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new ApiError("UNKNOWN_ERROR", res.status);
  return (await res.json()) as T;
}
