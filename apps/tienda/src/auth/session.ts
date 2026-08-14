import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";

export type StoreActor = {
  type: "store";
  id: string;
  ispId: string;
  name: string;
  phone: string;
  status: "invited" | "active" | "suspended";
};

export function login(phone: string, password: string) {
  return api<{ type: string; id: string; name: string }>("/auth/store/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });
}

export function logout() {
  return api<Record<string, never>>("/auth/logout", { method: "POST" });
}

/* The cookie is the session (spec D3): the shell asks /auth/me and reacts —
   200 app, 401 login, 403 suspended. Transparent refresh happens API-side,
   so a single attempt is enough. */
export function useSession() {
  const query = useQuery<StoreActor, ApiError>({
    queryKey: ["session"],
    queryFn: () => api<StoreActor>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  const suspended = query.error instanceof ApiError && query.error.code === "ACCOUNT_SUSPENDED";
  return { ...query, suspended };
}
