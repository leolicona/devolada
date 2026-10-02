import { useQuery } from "@tanstack/react-query";
import type {
  AcceptStoreInvitationRequest,
  AcceptStoreInvitationResponse,
  InvitationPreviewResponse,
  StoreInvitationCodeRequest,
  StoreInvitationCodeResponse,
  StoreMeResponse,
  StoreSignInCodeRequest,
  StoreSignInCodeResponse,
  StoreSignInRequest,
  StoreSignInResponse,
} from "@devolada/api/store-schema";
import { api, ApiError, baPost } from "@/lib/api";

/* cash-at-stores D2: the store app accepts one kind of actor. `/auth/me`
   answers a business member too — that account is refused here with its
   own screen (FR-013), never sent into the counter. The store branch
   carries the account's own `email`, where Caja's step-up sends its código
   (passwordless-access D8). */
export function useSession() {
  return useQuery<StoreMeResponse, ApiError>({
    queryKey: ["session"],
    queryFn: async () => {
      const me = await api<StoreMeResponse | { type: string }>("/auth/me");
      if (me.type !== "store") throw new ApiError("WRONG_ACTOR", 403);
      return me as StoreMeResponse;
    },
    retry: false,
    staleTime: 60_000,
  });
}

export const signOut = () => baPost("/auth/sign-out");

const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
const invitationPath = (token: string) => `/store/invitations/${encodeURIComponent(token)}`;

/* ---- The invitation (passwordless-access D10, contracts/store-access.md) ----
   An email and its código, no password. The código goes out first, to
   whatever address was typed; a taken one is named only after its código
   (FR-032). The account is born at the código, never at the email (FR-031). */

export const previewInvitation = (token: string) => api<InvitationPreviewResponse>(invitationPath(token));

export const sendInvitationCode = (token: string, email: string) =>
  post<StoreInvitationCodeResponse>(`${invitationPath(token)}/code`, { email } satisfies StoreInvitationCodeRequest);

export const acceptInvitation = (token: string, email: string, otp: string) =>
  post<AcceptStoreInvitationResponse>(`${invitationPath(token)}/accept`, { email, otp } satisfies AcceptStoreInvitationRequest);

/* ---- The sign-in by phone (D10; cash-at-stores D3) ----
   Two calls, so each answer is the same for every phone (FR-033): the
   código goes to the store account's email only when a store names that
   phone, and the try answers INVALID_OTP alike for a wrong código and a
   phone that names no store. The phone travels as ten digits, as the
   core's `nationalPhone` reads it. */

export const sendSignInCode = (phone: string) =>
  post<StoreSignInCodeResponse>("/store/sign-in/code", { phone } satisfies StoreSignInCodeRequest);

export const signInWithCode = (phone: string, otp: string) =>
  post<StoreSignInResponse>("/store/sign-in", { phone, otp } satisfies StoreSignInRequest);

/* ---- Caja's step-up (D8) ----
   A key needs a session younger than a day. An older one asks for a código
   at the store account's own address (`/auth/me`'s `email`) through Better
   Auth's own email-OTP doors — envelope-exempt, as `baPost` expects — and
   the código opens a fresh session for the ceremony. The address is the
   session's, so the sign-in can create no one (FR-034). */

export const sendStepUpCode = (email: string) =>
  baPost("/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

export const confirmStepUpCode = (email: string, otp: string) => baPost("/auth/sign-in/email-otp", { email, otp });

/* D11: every other session of the store account ends; this one stays */
export const revokeOtherSessions = () => baPost("/auth/revoke-other-sessions");
