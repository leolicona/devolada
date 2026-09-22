import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { Button } from "@devolada/ui";
import type { PruneNoticeResponse } from "@devolada/api/direct-payments-schema";
import { api, ApiError } from "@/lib/api";
import { roleCan } from "@devolada/api/role-matrix";
import { useSession } from "../auth/session";

/* links-on-demand-search FR-023 (D13): the one-time cleanup, told once.

   When this feature shipped, every panel link the retired roster had
   made that no payment and no clave attempt ever referenced was
   deleted — roughly 6,513 on the connected ISP. The business has to be
   told, and told plainly, because of what it costs: Devolada records no
   delivery, so a link an operator SENT last week and one the sweep made
   that nobody touched were identical in the data. Both went. A customer
   holding a copy of the first one will find it no longer works, and
   gets a new link at a new address the next time an operator acts
   (FR-024).

   Dismissing it is server-side, not a browser preference: it is a
   TELLING, and it is told to the business rather than to whichever
   browser happened to see it. `payments: operate` is what dismisses —
   a viewer should not silence the record for everyone. */

const COUNT = new Intl.NumberFormat("es-MX");

export function PruneNotice() {
  const client = useQueryClient();
  const { data: actor } = useSession();
  const canDismiss = roleCan(actor?.role ?? "viewer", "payments", "operate");

  const notice = useQuery<PruneNoticeResponse, ApiError>({
    queryKey: ["prune-notice"],
    queryFn: () => api<PruneNoticeResponse>("/direct-payments/prune-notice"),
    retry: false,
    /* Once per visit to the page is plenty for a one-time event */
    staleTime: Infinity,
  });

  const dismiss = useMutation({
    mutationFn: () => api<{ dismissed: true }>("/direct-payments/prune-notice/dismiss", { method: "POST" }),
    onSuccess: () => client.setQueryData(["prune-notice"], null),
  });

  if (!notice.data) return null;

  return (
    <div
      role="status"
      className="mt-4 flex flex-col items-start gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <span className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Limpiamos {COUNT.format(notice.data.deletedCount)}{" "}
          {notice.data.deletedCount === 1 ? "link de pago" : "links de pago"} que nadie había usado.
          Si compartiste alguno antes y tu cliente todavía no paga, ese link dejó de funcionar:
          vuelve a mandárselo desde aquí y tendrá uno nuevo.
        </span>
      </span>
      {canDismiss && (
        <Button
          size="compact"
          variant="secondary"
          className="shrink-0"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          <X className="mr-2 size-4" aria-hidden />
          Entendido
        </Button>
      )}
    </div>
  );
}
