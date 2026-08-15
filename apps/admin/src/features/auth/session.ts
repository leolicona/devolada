import { useQuery } from "@tanstack/react-query";
import { api, ApiError, baPost } from "@/lib/api";

export type IspActor = {
  type: "isp";
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  /* Settings D7: the display settings ride the session */
  timezone: string;
  timeFormat: "12h" | "24h";
  wisphubConfigured: boolean;
};

export function useSession() {
  const query = useQuery<IspActor, ApiError>({
    queryKey: ["session"],
    queryFn: () => api<IspActor>("/auth/me"),
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
  api("/auth/isp/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });

export const logout = () => baPost("/auth/sign-out");

export const sendVerificationCode = (email: string) =>
  baPost("/auth/email-otp/send-verification-otp", { email, type: "email-verification" });

export const verifyEmailCode = (email: string, otp: string) =>
  baPost("/auth/email-otp/verify-email", { email, otp });

export const requestPasswordReset = (email: string) =>
  baPost("/auth/email-otp/request-password-reset", { email });

export const resetPasswordWithCode = (email: string, otp: string, password: string) =>
  baPost("/auth/email-otp/reset-password", { email, otp, password });
