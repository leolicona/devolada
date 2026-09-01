import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "./features/shell/Shell";
import { LoginPage, RecoverPage, SignupPage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";
import { CobrosScreen } from "./features/cobros/CobrosScreen";
import { LinksScreen } from "./features/links/LinksScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { NewBusinessScreen } from "./features/onboarding/NewBusinessScreen";
import { AcceptInvitationScreen } from "./features/invitations/AcceptInvitationScreen";
import { OperatorScreen } from "./features/operator/OperatorScreen";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

/* /verify and /reset died with the links (better-auth.spec.md D4):
   codes are typed where they are asked, never clicked. */
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup", component: SignupPage });
const recoverRoute = createRoute({ getParentRoute: () => rootRoute, path: "/recover", component: RecoverPage });
/* Outside the shell: both exist before (or without) an active business */
const newBusinessRoute = createRoute({ getParentRoute: () => rootRoute, path: "/nuevo-negocio", component: NewBusinessScreen });
const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitaciones/$invitationId",
  component: AcceptInvitationScreen,
});

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: Shell });

/* payments-and-classes D6: the feed lives at /payments (routes are
   identifiers, English — the IA's rule); "/" still lands there. */
const feedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/payments",
  component: FeedScreen,
});
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: () => <Navigate to="/payments" />,
});
/* cobros-live (US-R01): the live section */
const cobrosRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/payment-requests",
  component: CobrosScreen,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsScreen,
});

const linksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/links",
  component: LinksScreen,
});
/* operator-panel D3: a route in the admin, hidden unless you are the operator */
const operatorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/operador",
  component: OperatorScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  recoverRoute,
  newBusinessRoute,
  invitationRoute,
  appRoute.addChildren([indexRoute, feedRoute, cobrosRoute, linksRoute, settingsRoute, operatorRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
