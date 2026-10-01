import { Outlet, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useSession } from "@/features/auth/session";
import { useWide } from "@/lib/wide";
import { CounterHeading, SearchPanel, SearchScreen } from "./SearchScreen";

/* cash-at-stores D32: *Cobrar* on a computer. One section, two halves:
   the search stays on the left while the debt, then the payment, show on
   the right. On a phone each route is its own screen, as D26 has it. */
export function CounterLayout() {
  const wide = useWide();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!wide) return <Outlet />;
  /* A recorded payment ends that search: the next customer starts from
     an empty box, as *Nuevo cobro* does on a phone */
  const paid = pathname.startsWith("/cobros/");
  return (
    <section className="space-y-6" aria-labelledby="cobrar-title">
      <CounterHeading />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SearchPanel key={paid ? "paid" : "searching"} autoFocus={!paid} />
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </section>
  );
}

/* `/`: the search screen on a phone; on a computer the search is already
   on the left, so the right half says what will appear there */
export function CounterIndex() {
  const wide = useWide();
  const session = useSession();
  if (!wide) return <SearchScreen />;
  if (!session.data?.businessName) return null;
  return (
    <p className="flex items-center gap-3 rounded-md border border-dashed border-line p-6 text-base text-ink-soft">
      <Search className="size-5 shrink-0" aria-hidden />
      Busca a un cliente para ver aquí su adeudo y cobrarle.
    </p>
  );
}
