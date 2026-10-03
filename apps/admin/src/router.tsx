import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Shell } from "./features/shell/Shell";
import { LoginPage, SignupPage, WelcomePage } from "./features/auth/pages";
import { FeedScreen } from "./features/feed/FeedScreen";
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
import { CashPointsScreen } from "./features/cash-points/CashPointsScreen";

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
/* passwordless-access D6: the código is a step of /login and /signup now.
   An old link to /verify-email lands on /login with its validated `next`;
   the address it may carry is dropped — an address never travels in a URL
   (analysis I5). Three lines spare a bookmark the not-found page. */
function VerifyEmailRedirect() {
  const { next } = verifyEmailRoute.useSearch();
  return <Navigate to="/login" search={{ next }} replace />;
}
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: VerifyEmailRedirect,
  validateSearch: nextSearch,
});
/* passwordless-access D6: where every door that opens a session by código
   lands — the name if it is missing, then the key (D7) — before `next` */
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  component: WelcomePage,
  validateSearch: nextSearch,
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
/* passwordless-access D6: no password, so nothing to recover — the código
   on /login is the way back in. An old link lands there keeping `next`
   (bug: invitee-lands-own-business: an invitee still comes back to the
   invitation), and drops the address, as /verify-email does. */
function RecoverRedirect() {
  const { next } = recoverRoute.useSearch();
  return <Navigate to="/login" search={{ next }} replace />;
}
const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  component: RecoverRedirect,
  validateSearch: nextSearch,
});
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
/* cobros-in-links D12, FR-014: the Cobros section's route is GONE, with
   no redirect — its view lives inside Links now (`/links?view=receivables`).
   A bookmark to the old address gets the router's not-found answer. The
   API path of the same name is a different namespace and stays (D1). */
/* cash-at-stores D23, T059: the business's cash at the network's stores,
   at the address the plan names (`/puntos-de-pago`) — the one panel route
   in Spanish, like the store app's own (D26) */
const cashPointsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/puntos-de-pago",
  component: CashPointsScreen,
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

/* links-on-demand-search D11 (FR-011): the search text lives in the
   ADDRESS. That is what makes it survive navigating away and back, the
   browser's back button and a reload — and what gives a search an
   address at all, so an operator can send one to a colleague. An empty
   or blank `q` is no search: it becomes undefined, so the address of a
   plain browse carries nothing.

   cobros-in-links D12 (FR-009): the chosen VIEW lives beside it, for the
   same four reasons. Absent is the customer view, the default (FR-001);
   `receivables` is Por cobrar. Any other value drops it, so a mistyped
   address opens on the customer view rather than on nothing. English,
   because the value is an identifier (routes are English, IA rule). */
export type LinksView = "customers" | "receivables";
export const linksSearch = (s: Record<string, unknown>): { q?: string; view?: "receivables" } => ({
  q: typeof s.q === "string" && s.q.trim() !== "" ? s.q : undefined,
  view: s.view === "receivables" ? "receivables" : undefined,
});
const linksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/links",
  component: LinksScreen,
  validateSearch: linksSearch,
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
  welcomeRoute,
  recoverRoute,
  newBusinessRoute,
  invitationRoute,
  appRoute.addChildren([
    indexRoute,
    feedRoute,
    linksRoute,
    cashPointsRoute,
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
