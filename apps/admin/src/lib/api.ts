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
