import { useQuery } from "@tanstack/react-query";
import type { StoreMeResponse } from "@devolada/api/store-schema";
import { api, ApiError, baPost } from "@/lib/api";

/* cash-at-stores D2: the store app accepts one kind of actor. `/auth/me`
   answers a business member too — that account is refused here with its
   own screen (FR-013), never sent into the counter. */
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

/* D3: the phone is the sign-in name — ten digits, as the core reads them */
export const signIn = (phone: string, password: string) =>
  baPost("/auth/sign-in/username", { username: phone, password });

export const signOut = () => baPost("/auth/sign-out");

/* D5, FR-011: codes, never links */
export const sendCode = (email: string, type: "email-verification" | "forget-password") =>
  baPost("/auth/email-otp/send-verification-otp", { email, type });

/* `autoSignInAfterVerification`: the código signs the shopkeeper in */
export const verifyEmail = (email: string, otp: string) => baPost("/auth/email-otp/verify-email", { email, otp });

export const resetPassword = (email: string, otp: string, password: string) =>
  baPost("/auth/email-otp/reset-password", { email, otp, password });
