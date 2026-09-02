import { Alert, Card } from "@devolada/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { AccessLayout } from "../auth/AccessLayout";
import { SignOutLink } from "../auth/SignOutLink";
import { listOrganizations, setActiveBusiness } from "../auth/session";

/* business-and-memberships D4 (US-B02): several memberships and no
   active one — the client offers the choice. `revoked` is the same
   screen with the reason named: the workspace the session pointed at is
   no longer this user's. */
export function ChooseBusinessScreen({ reason }: { reason: "choose" | "revoked" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgs = useQuery<{ id: string; name: string }[], ApiError>({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    retry: false,
  });

  async function choose(organizationId: string) {
    await setActiveBusiness(organizationId);
    queryClient.clear();
    void navigate({ to: "/" });
  }

  return (
    <AccessLayout title="Elige un negocio" description="Entras a uno a la vez; puedes cambiar cuando quieras.">
      {reason === "revoked" && (
        <Alert variant="warning">Ya no formas parte del negocio en el que estabas. Elige otro.</Alert>
      )}
      {orgs.isPending && <p className="text-sm text-ink-soft">Cargando…</p>}
      {orgs.error && (
        <Alert variant="destructive">
          No pudimos cargar tus negocios.{" "}
          <button type="button" className="underline" onClick={() => void orgs.refetch()}>
            Reintentar
          </button>
        </Alert>
      )}
      {orgs.data && (
        <ul className="space-y-2">
          {orgs.data.map((org) => (
            <li key={org.id}>
              <Card className="p-0">
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-4 py-3 text-left"
                  onClick={() => void choose(org.id)}
                >
                  <Building2 className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{org.name}</span>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-sm">
        <Link to="/nuevo-negocio" className="text-link hover:underline">
          Crear negocio
        </Link>
      </p>
      <SignOutLink />
    </AccessLayout>
  );
}
