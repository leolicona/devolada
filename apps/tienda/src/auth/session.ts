import { useQuery } from "@tanstack/react-query";
import { api, ApiError, baPost } from "../api/client";

export type StoreActor = {
  type: "store";
  id: string;
  ispId: string;
  name: string;
  phone: string;
  status: "invited" | "active" | "suspended";
};

/* Daily login keeps phone + password (better-auth.spec.md D2); the
   phone is the Better Auth username. A suspended store completes the
   sign-in and the shell's /auth/me answers 403 one request later (D5). */
export function login(phone: string, password: string) {
  return baPost("/auth/sign-in/username", { username: phone, password });
}

export function logout() {
  return baPost("/auth/sign-out");
}

/* Recovery and email confirmation by código (spec D4) */
export const requestPasswordReset = (email: string) =>
  baPost("/auth/email-otp/request-password-reset", { email });

export const resetPasswordWithCode = (email: string, otp: string, password: string) =>
  baPost("/auth/email-otp/reset-password", { email, otp, password });

export const verifyEmailCode = (email: string, otp: string) =>
  baPost("/auth/email-otp/verify-email", { email, otp });

/* The cookie is the session (spec D3): the shell asks /auth/me and reacts —
   200 store app, 200 other actor → login, 401 login, 403 suspended.
   Transparent refresh happens API-side, so a single attempt is enough. */
export function useSession() {
  const query = useQuery<StoreActor, ApiError>({
    queryKey: ["session"],
    queryFn: async () => {
      const actor = await api<StoreActor>("/auth/me");
      /* Both apps talk to one API host, so they share one session cookie
         (better-auth.spec.md D7). An ISP signed in on the admin reaches
         here with a session that is valid but is not a store's: /auth/me
         answers 200, the shell used to draw the tabs, and then Caja,
         Movimientos and the customer search all answered 403. The type
         is checked, never assumed. */
      if (actor.type !== "store") throw new ApiError("WRONG_ACTOR", 403);
      return actor;
    },
    retry: false,
    staleTime: 60_000,
  });
  const suspended = query.error instanceof ApiError && query.error.code === "ACCOUNT_SUSPENDED";
  return { ...query, suspended };
}
