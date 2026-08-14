import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Shell, SectionPlaceholder } from "./features/shell/Shell";
import { LoginPage, RecoverPage, ResetPage, SignupPage, VerifyPage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", component: SignupPage });
const verifyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/verify", component: VerifyPage });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", component: RecoverPage });
const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reset", component: ResetPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: Shell });

const feedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: FeedScreen,
});
const storesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/stores",
  component: () => <SectionPlaceholder title="Tiendas" next="La gestión de tiendas" />,
});
const dropsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/cash-drops",
  component: () => <SectionPlaceholder title="Entregas" next="La confirmación de entregas" />,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: () => <SectionPlaceholder title="Configuración" next="La configuración del ISP" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  verifyRoute,
  recoverRoute,
  resetRoute,
  appRoute.addChildren([feedRoute, storesRoute, dropsRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
