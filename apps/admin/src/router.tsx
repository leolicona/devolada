import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "./features/shell/Shell";
import { LoginPage, RecoverPage, SignupPage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";
import { StoresScreen } from "./features/stores/StoresScreen";
import { NewStoreScreen } from "./features/stores/NewStoreScreen";
import { StoreDetailScreen } from "./features/stores/StoreDetailScreen";
import { CashDropsScreen } from "./features/cash-drops/CashDropsScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

/* /verify and /reset died with the links (better-auth.spec.md D4):
   codes are typed where they are asked, never clicked. */
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", component: SignupPage });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", component: RecoverPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: Shell });

const feedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: FeedScreen,
});
const storesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/stores",
  component: StoresScreen,
});

const newStoreRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/stores/new",
  component: NewStoreScreen,
});

const storeDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/stores/$storeId",
  component: StoreDetailScreen,
});
const dropsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cash-drops",
  component: CashDropsScreen,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  recoverRoute,
  appRoute.addChildren([feedRoute, storesRoute, newStoreRoute, storeDetailRoute, dropsRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
