import { useQuery } from "@tanstack/react-query";
import { api, ApiError, baGet, baPost, baPostJson } from "@/lib/api";
import type { AcceptInvitationNewRequest, CreateBusinessRequest } from "@devolada/api/businesses-schema";

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
  /* integrations-hub D10: any provider — the shell names none */
  integrationConfigured: boolean;
  /* cobros-in-links D13: what the integration can do. The Por cobrar
     chip needs `receivables`, a search result's debt `customerDebt`
     (FR-013). Empty with no integration. */
  integrationCapabilities: ("receivables" | "customerDebt" | "customersWithPhone" | "customerSearch" | "paymentActions")[];
  /* business-and-memberships D5 (2026-09-02): born without a CLABE */
  speiConfigured: boolean;
  /* integrations-hub D4: connected with actions off — the shell chip */
  observing: boolean;
  /* business-and-memberships D4: the membership's role and the switcher's list */
  role: "owner" | "admin" | "operator" | "viewer";
  orgId: string;
  userId: string;
  /* account-hub D2: the person, for the avatar and the identity card */
  userName: string;
  businesses: { id: string; orgId: string; name: string; role: "owner" | "admin" | "operator" | "viewer" }[];
  /* operator-panel D2 */
  platformOperator: boolean;
  /* prepaid-credit D7: the chip's step, computed by /auth/me alone */
  credit: { balanceCents: number; step: "ok" | "low" | "empty" | "paused" };
  /* cash-at-stores D7, D23: Puntos de pago shows from the first switch
     on (`since`), and stays (FR-034) */
  storeChannel: { on: boolean; since: number | null };
};

/* Shell spec D3: the guard accepts only business actors — the only kind
   the API resolves now (business-and-memberships D4). */
export function useSession() {
  const query = useQuery<BusinessActor, ApiError>({
    queryKey: ["session"],
    queryFn: async () => {
      /* cash-at-stores D2: a shopkeeper's session answers `type: "store"`;
         the shell gives it a screen of its own (FR-013) */
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


export const logout = () => baPost("/auth/sign-out");

/* passwordless-access D1: one door for registration and sign-in — the
   email-OTP plugin's. A código goes out for any well-formed address, and
   the account is born, verified and named, only when it is typed (FR-004,
   FR-005, FR-013). `name` rides only from the registration screen. */
export const sendCode = (email: string) =>
  baPost("/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

export const signInWithCode = (email: string, otp: string, name?: string) =>
  baPostJson<{ user: SessionUser }>("/auth/sign-in/email-otp", { email, otp, ...(name ? { name } : {}) });

/* D1, D6: a person born through the sign-in door has no name yet; /welcome asks */
export const updateName = (name: string) => baPost("/auth/update-user", { name });

/* D11: better-auth D17's guarantee without a password — every other session ends */
export const revokeOtherSessions = () => baPost("/auth/revoke-other-sessions");

/* The user behind the session, business or not — the wizard and the
   invitation page need it before any membership exists (US-B01/B02).
   `sessionBornAt` (ms) is when the session itself began: /welcome reads it
   before offering a key, which the plugin registers only on a session
   younger than a day (passwordless-access D8; adversarial review,
   2026-10-02). Absent when the answer does not say. */
export type SessionUser = { id: string; name: string; email: string; emailVerified: boolean; sessionBornAt?: number };
export function useUser() {
  return useQuery<SessionUser | null, ApiError>({
    queryKey: ["user"],
    queryFn: async () => {
      const s = await baGet<{ user: SessionUser; session?: { createdAt?: string } } | null>("/auth/get-session");
      if (!s?.user) return null;
      const bornAt = s.session?.createdAt ? Date.parse(s.session.createdAt) : Number.NaN;
      return Number.isNaN(bornAt) ? s.user : { ...s.user, sessionBornAt: bornAt };
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

/* Answers the organization joined, so the page can activate it: a person
   with a business of their own would otherwise land back in it. */
export const acceptInvitation = async (invitationId: string) => {
  const res = await baPostJson<{ invitation: { organizationId: string } }>(
    "/auth/organization/accept-invitation",
    { invitationId },
  );
  return { organizationId: res.invitation.organizationId };
};

/* better-auth D14: the session-less door for an invitee without an account.
   passwordless-access D9 (amended 2026-10-03, spec Clarifications Q5): it
   carries the name and the código sent to the invited address — the
   invitation's id alone proves no inbox. The answer sets the new session's
   cookie; a refused código comes back as INVALID_OTP in the envelope —
   wrong, expired or spent alike (FR-033) — and nothing is born. */
export const acceptInvitationAsNewUser = (invitationId: string, body: AcceptInvitationNewRequest) =>
  api<BusinessActor>(`/businesses/invitations/${invitationId}/accept-new`, { method: "POST", body: JSON.stringify(body) });

/* business-and-memberships D8/D12 */
export const resendInvitation = (invitationId: string) =>
  api(`/businesses/invitations/${invitationId}/resend`, { method: "POST" });
export const cancelInvitation = (invitationId: string) =>
  api(`/businesses/invitations/${invitationId}`, { method: "DELETE" });
export const updateMemberRole = (memberId: string, role: string) =>
  api(`/businesses/members/${memberId}`, { method: "PATCH", body: JSON.stringify({ role }) });
