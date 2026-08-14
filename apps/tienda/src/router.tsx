import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { LoginPage } from "./screens/LoginPage";
import { SearchScreen } from "./features/charge/SearchScreen";
import { ConfirmScreen } from "./features/charge/ConfirmScreen";
import { ResultScreen } from "./features/charge/ResultScreen";
import { CashboxScreen, LedgerScreen } from "./screens/placeholders";

/* Code-based route tree (spec D1): five routes, zero build magic. */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
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

const ledgerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/ledger",
  component: LedgerScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([chargeRoute, chargeConfirmRoute, chargeResultRoute, cashboxRoute, ledgerRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
