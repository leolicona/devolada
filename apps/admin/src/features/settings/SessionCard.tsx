import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Card } from "@devolada/ui";
import { Button } from "@/components/ui/button";
import { logout } from "../auth/session";

/* BUG-016: the only "Cerrar sesión" inside the shell lived in the
   desktop sidebar; on a phone there was no door out. This card is the
   one that exists at every width — the last thing in Configuración,
   for every role, since the session is the person's own. */
export function SessionCard({ email }: { email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Card className="p-6" id="sesion">
      <h2 className="scroll-mt-24 text-base font-semibold">Sesión</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Entraste como <span className="font-medium text-foreground">{email}</span>. En un
        dispositivo compartido, cierra la sesión al terminar.
      </p>
      <Button
        variant="outline"
        className="mt-4"
        onClick={async () => {
          await logout().catch(() => {});
          queryClient.clear();
          void navigate({ to: "/login" });
        }}
      >
        <LogOut className="size-4" aria-hidden />
        Cerrar sesión
      </Button>
    </Card>
  );
}
