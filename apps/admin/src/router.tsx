import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "./features/shell/Shell";
import { LoginPage, RecoverPage, SignupPage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";
import { LinksScreen } from "./features/links/LinksScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { NewBusinessScreen } from "./features/onboarding/NewBusinessScreen";
import { AcceptInvitationScreen } from "./features/invitations/AcceptInvitationScreen";

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

const feedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: FeedScreen,
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  recoverRoute,
  newBusinessRoute,
  invitationRoute,
  appRoute.addChildren([feedRoute, linksRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
