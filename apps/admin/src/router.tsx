import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "./features/shell/Shell";
import { LoginPage, RecoverPage, SignupPage, VerifyEmailPage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";
import { CobrosScreen } from "./features/cobros/CobrosScreen";
import { LinksScreen } from "./features/links/LinksScreen";
import {
  BusinessSettingsRedirect,
  DirectPaymentSettingsScreen,
  PreferencesScreen,
} from "./features/settings/SettingsScreen";
import { AccountIndex, AccountLayout } from "./features/account/AccountHub";
import { CreditScreen, SecurityScreen, UsersScreen } from "./features/account/pages";
import { NewBusinessScreen } from "./features/onboarding/NewBusinessScreen";
import { AcceptInvitationScreen } from "./features/invitations/AcceptInvitationScreen";
import { OperatorScreen } from "./features/operator/OperatorScreen";
import { IntegrationsScreen } from "./features/integrations/IntegrationsScreen";
import { WispHubScreen } from "./features/integrations/WispHubScreen";
import { ApiScreen } from "./features/integrations/ApiScreen";
import { WebhookScreen } from "./features/integrations/WebhookScreen";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

/* /verify and /reset died with the links (better-auth.spec.md D4):
   codes are typed where they are asked, never clicked. */
/* The guard remembers where you were going (better-auth.spec.md D12):
   `next` is a same-app path or nothing — never a host, or the login
   page becomes an open redirect one query string away. */
export const nextSearch = (s: Record<string, unknown>): { next?: string } => ({
  /* An explicit undefined: the router merges the validated object over
     the raw search, so a bare `{}` would keep the rejected value alive. */
  next: typeof s.next === "string" && /^\/(?!\/)/.test(s.next) ? s.next : undefined,
});
/* better-auth D16: the código screen knows the address it is for; a
   visit without one asks for it. */
export const verifySearch = (s: Record<string, unknown>): { next?: string; email?: string } => ({
  ...nextSearch(s),
  email: typeof s.email === "string" && s.email.includes("@") ? s.email : undefined,
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: VerifyEmailPage,
  validateSearch: verifySearch,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  validateSearch: nextSearch,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: SignupPage,
  validateSearch: nextSearch,
});
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
/* integrations-hub D1: catalog + detail (routes are English, IA rule) */
const integrationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrations",
  component: IntegrationsScreen,
});
const wisphubRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrations/wisphub",
  component: WispHubScreen,
});
/* automated-collections-api US1: the API card's detail — credentials */
const apiIntegrationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrations/api",
  component: ApiScreen,
});
/* automated-collections-api US2 (FR-018): the webhook's health */
const webhookIntegrationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/integrations/api/webhook",
  component: WebhookScreen,
});

/* account-hub D4: /settings is the hub (Cuenta); the areas are its
   children. The old anchors are redirected by the index on mount. */
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: AccountLayout,
});
const settingsIndexRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/", component: AccountIndex });
/* settings D11: the business's settings are two pages; /business is the
   path they came from and stays as a redirect, hash included. */
const settingsDirectPaymentRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/direct-payment", component: DirectPaymentSettingsScreen });
const settingsPreferencesRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/preferences", component: PreferencesScreen });
const settingsBusinessRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/business", component: BusinessSettingsRedirect });
const settingsCreditRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/credit", component: CreditScreen });
const settingsUsersRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/users", component: UsersScreen });
const settingsSecurityRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/security", component: SecurityScreen });

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
  verifyEmailRoute,
  recoverRoute,
  newBusinessRoute,
  invitationRoute,
  appRoute.addChildren([
    indexRoute,
    feedRoute,
    cobrosRoute,
    linksRoute,
    integrationsRoute,
    wisphubRoute,
    apiIntegrationRoute,
    webhookIntegrationRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsDirectPaymentRoute,
      settingsPreferencesRoute,
      settingsBusinessRoute,
      settingsCreditRoute,
      settingsUsersRoute,
      settingsSecurityRoute,
    ]),
    operatorRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
