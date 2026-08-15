/* Same envelope-aware fetch wrapper as the PWA (future packages/api-client). */
const BASE = import.meta.env.VITE_API_URL ?? "";

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
