import { Alert, Button, Card, ListError, Pending, Skeleton } from "@devolada/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import type { ApiError } from "@/lib/api";
import { AccessLayout } from "../auth/AccessLayout";
import { SignOutLink } from "../auth/SignOutLink";
import { listOrganizations, setActiveBusiness } from "../auth/session";
import { PendingInvitations } from "../invitations/PendingInvitations";

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
      {/* bug: invitee-lands-own-business — a business that invited this
          person is one more place to go: named here too, where someone with
          several businesses lands right after signing in */}
      <PendingInvitations stacked className="mb-4" />
      {orgs.error && (
        <ListError what="tus negocios" onRetry={() => orgs.refetch()} />
      )}
      {/* feedback-vocabulary-rollout D1/D5/D7: the region owns the wait. The shape
          holds the space while the threshold runs; `isPending` is the first
          load, never a refetch the operator did not start. */}
      <Pending
        active={orgs.isPending}
        label="Cargando tus negocios"
        shape={
          <Skeleton className="h-24 w-full" />
        }
      >
        {orgs.data && (
          <ul className="space-y-2">
            {orgs.data.map((org) => (
              <li key={org.id}>
                <Card className="p-0">
                  <Button size="compact"
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
      </Pending>
      <p className="text-center text-sm">
        <Link to="/nuevo-negocio" className="text-link hover:underline">
          Crear negocio
        </Link>
      </p>
      <SignOutLink />
    </AccessLayout>
  );
}
