import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { logout } from "./session";

/* A door out for every screen that holds a session but no shell —
   the wizard, the chooser, the suspended screen (design review
   "identidad", 2026-09-02, must fix 1). Without it, the person who
   signed up with the wrong email, or whose only business is suspended,
   was stuck until they cleared cookies. */
export function SignOutLink({ email }: { email?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function onLogout() {
    await logout().catch(() => {});
    queryClient.clear();
    void navigate({ to: "/login" });
  }
  return (
    <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 text-sm text-ink-soft">
      {email && <span className="truncate">Entraste como {email}.</span>}
      <button type="button" className="inline-flex items-center gap-1 text-link hover:underline" onClick={() => void onLogout()}>
        <LogOut className="size-4" aria-hidden />
        Cerrar sesión
      </button>
    </p>
  );
}
