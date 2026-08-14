import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

export type IspActor = {
  type: "isp";
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: "active" | "suspended";
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

export const login = (email: string, password: string) =>
  api("/auth/admin/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const signup = (name: string, email: string, password: string) =>
  api("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });

export const logout = () => api("/auth/logout", { method: "POST" });

export const verifyEmail = (token: string) =>
  api("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });

export const resendVerification = () =>
  api("/auth/resend-verification", { method: "POST" });

export const recover = (email: string) =>
  api("/auth/recover", { method: "POST", body: JSON.stringify({ email }) });

export const resetPassword = (token: string, password: string) =>
  api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
