import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { TabLayout } from "./layout/TabLayout";
import { LoginScreen } from "./features/auth/LoginScreen";
import { RecoverScreen } from "./features/auth/RecoverScreen";
import { InvitationScreen } from "./features/auth/InvitationScreen";
import { CounterIndex, CounterLayout } from "./features/counter/CounterLayout";
import { QuoteScreen } from "./features/counter/QuoteScreen";
import { ResultScreen } from "./features/counter/ResultScreen";
import { CashboxScreen } from "./features/cashbox/CashboxScreen";
import { HandoverScreen } from "./features/cashbox/HandoverScreen";
import { LedgerScreen } from "./features/cashbox/LedgerScreen";
import { HandoversScreen } from "./features/cashbox/HandoversScreen";

/* cash-at-stores D26: the store app's routes, in es-MX. Outside the tabs:
   the ways in. Inside them: the counter and the cash book. */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/entrar", component: LoginScreen });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recuperar", component: RecoverScreen });
const invitationRoute = createRoute({ getParentRoute: () => rootRoute, path: "/invitacion/$token", component: InvitationScreen });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: TabLayout });

/* D32: the counter's three routes share a layout — on a computer the
   search stays beside the debt and the payment */
const counterRoute = createRoute({ getParentRoute: () => appRoute, id: "counter", component: CounterLayout });
const searchRoute = createRoute({ getParentRoute: () => counterRoute, path: "/", component: CounterIndex });
const quoteRoute = createRoute({ getParentRoute: () => counterRoute, path: "/cobro/$usuario", component: QuoteScreen });
const resultRoute = createRoute({ getParentRoute: () => counterRoute, path: "/cobros/$id", component: ResultScreen });
const cashboxRoute = createRoute({ getParentRoute: () => appRoute, path: "/caja", component: CashboxScreen });

/* *Mi caja*'s numbers open these with the business (and the kind) they
   stand for (FR-037); anything else drops the value rather than send a
   request the API would refuse */
const KINDS = ["collection", "handover", "correction"] as const;
export const bookSearch = (
  s: Record<string, unknown>,
): { businessId?: string; kind?: (typeof KINDS)[number]; since?: number } => ({
  businessId: typeof s.businessId === "string" && s.businessId ? s.businessId : undefined,
  kind: KINDS.find((k) => k === s.kind),
  /* T079: the fees since the last hand-over open into the collections
     from that moment on */
  since: typeof s.since === "number" && Number.isInteger(s.since) && s.since >= 0 ? s.since : undefined,
});
const handoverRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/caja/entrega",
  component: HandoverScreen,
  validateSearch: (s: Record<string, unknown>): { businessId?: string } => ({ businessId: bookSearch(s).businessId }),
});
/* T080 (US5/AC6): the store's hand-overs to one business, disputes and
   their notes included */
const handoversRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/caja/entregas",
  component: HandoversScreen,
  validateSearch: (s: Record<string, unknown>): { businessId?: string } => ({ businessId: bookSearch(s).businessId }),
});
const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/movimientos",
  component: LedgerScreen,
  validateSearch: bookSearch,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  recoverRoute,
  invitationRoute,
  appRoute.addChildren([counterRoute.addChildren([searchRoute, quoteRoute, resultRoute]), cashboxRoute, handoverRoute, handoversRoute, ledgerRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
