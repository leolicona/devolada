import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { LoginPage } from "./screens/LoginPage";
import { InvitationScreen } from "./features/invitation/InvitationScreen";
import { SearchScreen } from "./features/charge/SearchScreen";
import { ConfirmScreen } from "./features/charge/ConfirmScreen";
import { ResultScreen } from "./features/charge/ResultScreen";
import { CashboxScreen } from "./features/cashbox/CashboxScreen";
import { DropScreen } from "./features/cashbox/DropScreen";
import { LedgerScreen } from "./features/ledger/LedgerScreen";

/* Code-based route tree (spec D1): five routes, zero build magic. */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitation/$token",
  component: InvitationScreen,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
});

const chargeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: SearchScreen,
});

const chargeConfirmRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/charge/$customerId",
  component: ConfirmScreen,
});

const chargeResultRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/charges/$chargeId",
  component: ResultScreen,
});

const cashboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cashbox",
  component: CashboxScreen,
});

const cashDropRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cashbox/drop",
  component: DropScreen,
});

const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/ledger",
  component: LedgerScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  invitationRoute,
  appRoute.addChildren([chargeRoute, chargeConfirmRoute, chargeResultRoute, cashboxRoute, cashDropRoute, ledgerRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
