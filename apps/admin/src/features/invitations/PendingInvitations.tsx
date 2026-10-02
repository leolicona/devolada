import { Alert, Button } from "@devolada/ui";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import type { MyInvitationsResponse } from "@devolada/api/businesses-schema";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "../auth/roles";

/* bug: invitee-lands-own-business — an invitation reaches the person it
   was sent to wherever they sign in, not only through its email. An
   invitee who already had a business and signed in any other way (the
   login page, a password recovery, an email that had not arrived) landed
   in their own business, and nothing named the invitation again.

   "Unirme" opens the invitation page, which accepts for the invited
   address signed in (better-auth D14): one way to accept, not two. An
   offer, never a blocker — silent while it loads, when there is nothing,
   and when the read fails. `stacked` keeps the button under the sentence
   in a narrow card (the wizard); the shell's banner puts it beside.
   A named region, not a live one: an offer read on arrival is not news to
   interrupt a screen reader with (the Alert's own rule for neutral
   notices), but it must still sit inside a landmark. */
export function PendingInvitations({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  const { data } = useQuery<MyInvitationsResponse, ApiError>({
    queryKey: ["my-invitations"],
    queryFn: () => api<MyInvitationsResponse>("/businesses/invitations/mine"),
    retry: false,
    /* The session's own pace (useSession): an invitation is not news by the second */
    staleTime: 60_000,
  });
  if (!data?.invitations.length) return null;

  return (
    <section aria-label="Invitaciones para ti" className={cn("flex flex-col gap-3", className)}>
      {data.invitations.map((inv) => (
        <Alert
          key={inv.id}
          className={cn(
            "flex flex-col items-start gap-3",
            !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-4",
          )}
        >
          <span className="flex items-center gap-2">
            <UserPlus className="size-4 shrink-0" aria-hidden />
            <span>
              Te invitaron a <strong>{inv.businessName}</strong> como {ROLE_LABELS[inv.role].toLowerCase()}.
            </span>
          </span>
          <Link to="/invitaciones/$invitationId" params={{ invitationId: inv.id }} className="block">
            <Button size="compact" variant="secondary" aria-label={`Unirme a ${inv.businessName}`}>
              Unirme
            </Button>
          </Link>
        </Alert>
      ))}
    </section>
  );
}
