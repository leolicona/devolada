/* The envelope-aware fetch wrapper, as the admin's (`apps/admin/src/lib/api.ts`). */
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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    /* cash-at-stores D26: the counter's own word for a lost signal — the
       tab layout's banner says it, never a raw TypeError */
    throw new ApiError("NETWORK_ERROR", 0);
  }
  let json: { success: boolean; data: T; error?: { code?: string } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new ApiError("UNKNOWN_ERROR", res.status);
  }
  if (!res.ok || !json.success) {
    const code = json.error?.code ?? "UNKNOWN_ERROR";
    /* FR-014: a suspension ends the session on the next action, wherever
       it lands — the layout listens and shows the suspended screen */
    if (code === "STORE_SUSPENDED" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(STORE_SUSPENDED_EVENT));
    }
    throw new ApiError(code, res.status);
  }
  return json.data;
}

export const STORE_SUSPENDED_EVENT = "devolada:store-suspended";

/* Better Auth endpoints (constitution III's one exemption): no envelope.
   Non-2xx throws with Better Auth's error code. */
export async function baPost(path: string, body?: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", 0);
  }
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

/* Better Auth GET endpoints: raw JSON, no envelope */
export async function baGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new ApiError("UNKNOWN_ERROR", res.status);
  return (await res.json()) as T;
}
