import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { TabLayout } from "./layout/TabLayout";
import { LoginScreen } from "./features/auth/LoginScreen";
import { RecoverScreen } from "./features/auth/RecoverScreen";
import { InvitationScreen } from "./features/auth/InvitationScreen";
import { SuspendedScreen } from "./features/auth/Gate";
import { SearchScreen } from "./features/counter/SearchScreen";
import { QuoteScreen } from "./features/counter/QuoteScreen";
import { ResultScreen } from "./features/counter/ResultScreen";
import { CashboxScreen } from "./features/cashbox/CashboxScreen";
import { HandoverScreen } from "./features/cashbox/HandoverScreen";
import { LedgerScreen } from "./features/cashbox/LedgerScreen";

/* cash-at-stores D26: the store app's routes, in es-MX. Outside the tabs:
   the ways in. Inside them: the counter and the cash book. */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/entrar", component: LoginScreen });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recuperar", component: RecoverScreen });
const invitationRoute = createRoute({ getParentRoute: () => rootRoute, path: "/invitacion/$token", component: InvitationScreen });
const suspendedRoute = createRoute({ getParentRoute: () => rootRoute, path: "/suspendida", component: SuspendedScreen });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: TabLayout });

const searchRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: SearchScreen });
const quoteRoute = createRoute({ getParentRoute: () => appRoute, path: "/cobro/$usuario", component: QuoteScreen });
const resultRoute = createRoute({ getParentRoute: () => appRoute, path: "/cobros/$id", component: ResultScreen });
const cashboxRoute = createRoute({ getParentRoute: () => appRoute, path: "/caja", component: CashboxScreen });

/* *Mi caja*'s numbers open these with the business (and the kind) they
   stand for (FR-037); anything else drops the value rather than send a
   request the API would refuse */
const KINDS = ["collection", "handover", "correction"] as const;
export const cashSearch = (s: Record<string, unknown>): { businessId?: string; kind?: (typeof KINDS)[number] } => ({
  businessId: typeof s.businessId === "string" && s.businessId ? s.businessId : undefined,
  kind: KINDS.find((k) => k === s.kind),
});
const handoverRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/caja/entrega",
  component: HandoverScreen,
  validateSearch: (s: Record<string, unknown>): { businessId?: string } => ({ businessId: cashSearch(s).businessId }),
});
const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/movimientos",
  component: LedgerScreen,
  validateSearch: cashSearch,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  recoverRoute,
  invitationRoute,
  suspendedRoute,
  appRoute.addChildren([searchRoute, quoteRoute, resultRoute, cashboxRoute, handoverRoute, ledgerRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
