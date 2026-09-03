import { Navigate } from "@tanstack/react-router";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";
import { CreditCard } from "../credit/CreditCard";
import { UsersCard } from "../settings/UsersCard";
import { PasskeyCard } from "../auth/PasskeyCard";
import { SubPage } from "./AccountHub";

/* The sub-pages that are one card each (account-hub D4). A role that may
   not use one is sent back to the hub — hidden, never disabled. */

export function CreditScreen() {
  const { data: actor } = useSession();
  if (!actor) return null;
  if (!roleCan(actor.role, "credit", "manage")) return <Navigate to="/settings" replace />;
  return (
    <SubPage>
      <CreditCard />
    </SubPage>
  );
}

export function UsersScreen() {
  const { data: actor } = useSession();
  if (!actor) return null;
  if (!roleCan(actor.role, "members", "invite_below_admin")) return <Navigate to="/settings" replace />;
  return (
    <SubPage>
      <UsersCard role={actor.role} selfUserId={actor.userId} />
    </SubPage>
  );
}

export function SecurityScreen() {
  return (
    <SubPage>
      <PasskeyCard />
    </SubPage>
  );
}
