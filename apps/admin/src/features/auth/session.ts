import { useQuery } from "@tanstack/react-query";
import { api, ApiError, baGet, baPost } from "@/lib/api";
import type { CreateBusinessRequest } from "@devolada/api/businesses-schema";

export type BusinessActor = {
  type: "business";
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  /* Settings D7: the display settings ride the session */
  timezone: string;
  timeFormat: "12h" | "24h";
  wisphubConfigured: boolean;
  /* integrations-hub D4: connected with actions off — the shell chip */
  observing: boolean;
  /* business-and-memberships D4: the membership's role and the switcher's list */
  role: "owner" | "admin" | "operator" | "viewer";
  orgId: string;
  userId: string;
  businesses: { id: string; orgId: string; name: string; role: "owner" | "admin" | "operator" | "viewer" }[];
  /* operator-panel D2 */
  platformOperator: boolean;
  /* prepaid-credit D7: the chip's step, computed by /auth/me alone */
  credit: { balanceCents: number; step: "ok" | "low" | "empty" | "paused" };
};

/* Shell spec D3: the guard accepts only business actors — the only kind
   the API resolves now (business-and-memberships D4). */
export function useSession() {
  const query = useQuery<BusinessActor, ApiError>({
    queryKey: ["session"],
    queryFn: async () => {
      const actor = await api<BusinessActor>("/auth/me");
      if (actor.type !== "business") throw new ApiError("WRONG_ACTOR", 403);
      return actor;
    },
    retry: false,
    staleTime: 60_000,
  });
  return query;
}

/* Every screen that shows a time asks here, so one setting reaches all
   of them without a second request (D6, D7). */
export function useDisplaySettings(): { timezone: string; timeFormat: "12h" | "24h" } {
  const { data } = useSession();
  return {
    timezone: data?.timezone ?? "America/Mexico_City",
    timeFormat: data?.timeFormat ?? "12h",
  };
}

/* Daily login keeps the password (better-auth.spec.md D2);
   registration and recovery prove the email with a code (D4). */

export const login = (email: string, password: string) =>
  baPost("/auth/sign-in/email", { email, password });

export const signup = (name: string, email: string, password: string) =>
  api("/auth/business/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });

export const logout = () => baPost("/auth/sign-out");

/* The user behind the session, business or not — the wizard and the
   invitation page need it before any membership exists (US-B01/B02). */
export type SessionUser = { id: string; name: string; email: string; emailVerified: boolean };
export function useUser() {
  return useQuery<SessionUser | null, ApiError>({
    queryKey: ["user"],
    queryFn: async () => {
      const s = await baGet<{ user: SessionUser } | null>("/auth/get-session");
      return s?.user ?? null;
    },
    retry: false,
  });
}

/* business-and-memberships: the wizard's one call (D5), the switch and
   the invitation flow ride the organizations plugin (D1, envelope-exempt). */
export const createBusiness = (body: CreateBusinessRequest) =>
  api<BusinessActor>("/businesses", { method: "POST", body: JSON.stringify(body) });

export const setActiveBusiness = (organizationId: string) =>
  baPost("/auth/organization/set-active", { organizationId });

export const listOrganizations = () => baGet<{ id: string; name: string }[]>("/auth/organization/list");

export const acceptInvitation = (invitationId: string) =>
  baPost("/auth/organization/accept-invitation", { invitationId });

export const sendVerificationCode = (email: string) =>
  baPost("/auth/email-otp/send-verification-otp", { email, type: "email-verification" });

export const verifyEmailCode = (email: string, otp: string) =>
  baPost("/auth/email-otp/verify-email", { email, otp });

export const requestPasswordReset = (email: string) =>
  baPost("/auth/email-otp/request-password-reset", { email });

export const resetPasswordWithCode = (email: string, otp: string, password: string) =>
  baPost("/auth/email-otp/reset-password", { email, otp, password });
