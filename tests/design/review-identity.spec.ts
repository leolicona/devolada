import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, feed, stubAdminApi } from "../e2e/stubs";

/* Design-review captures for the identity journey (US-S04, US-S06,
   US-B01–B03): login, signup, recovery, the wizard, the invitation page in
   its three states, the session screens the shell answers with
   (suspended, choose, revoked) and the team card. Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-identity.spec.ts */

const OUT = ".design/devolada/screenshots";

const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/* Better Auth endpoints answer raw JSON; ours wear the envelope. Both
   guards let document navigations through (see stubs.ts). */
async function raw(page: Page, pattern: string, status: number, body: unknown) {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill(json(status, body));
  });
}
const fail = (page: Page, pattern: string, code: string, status: number) =>
  raw(page, pattern, status, { success: false, error: { code } });
const ok = (page: Page, pattern: string, data: unknown) => raw(page, pattern, 200, { success: true, data });

const sessionUser = { id: "user-1", name: "Leo Licona", email: "leo@wifiplus.mx", emailVerified: false };
const signedIn = (page: Page, user = sessionUser) =>
  raw(page, "**/auth/get-session", 200, { user, session: { id: "s-1", userId: user.id } });
const signedOut = (page: Page) => raw(page, "**/auth/get-session", 200, null);

const settings = {
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: {
    clabe: "646180157000000004",
    bank: "STP",
    beneficiaryName: "WifiPlus SA de CV",
    serviceFeeCents: null,
    effectiveServiceFeeCents: 1500,
    bankUnknown: false,
    configured: true,
  },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
};
const members = {
  members: [
    { id: "m-1", userId: "user-1", name: "Leo Licona", email: "leo@wifiplus.mx", role: "owner", createdAt: 1 },
    { id: "m-2", userId: "user-2", name: "Ana Torres", email: "ana@wifiplus.mx", role: "admin", createdAt: 2 },
    { id: "m-3", userId: "user-3", name: "Carlos Mena", email: "carlos@wifiplus.mx", role: "operator", createdAt: 3 },
  ],
  grantable: ["owner", "admin", "operator", "viewer"],
};

type Shot = {
  slug: string;
  path: string;
  widths: number[];
  arrange?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
  act?: (page: Page) => Promise<void>;
};

const heading = (name: string | RegExp) => async (page: Page) =>
  expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });

const shots: Shot[] = [
  { slug: "login", path: "/login", widths: [1280, 375], ready: heading("Iniciar sesión") },
  {
    slug: "login-error",
    path: "/login",
    widths: [1280],
    arrange: (page) => raw(page, "**/auth/sign-in/email", 401, { code: "INVALID_EMAIL_OR_PASSWORD" }),
    ready: heading("Iniciar sesión"),
    act: async (page) => {
      await page.getByLabel("Correo").fill("leo@wifiplus.mx");
      await page.getByLabel("Contraseña").fill("no-es");
      await page.getByRole("button", { name: /^entrar$/i }).click();
      await expect(page.getByText(/correo o contraseña incorrectos/i)).toBeVisible();
    },
  },
  { slug: "signup", path: "/signup", widths: [1280, 375], ready: heading("Crear cuenta") },
  {
    slug: "signup-errors",
    path: "/signup",
    widths: [1280, 375],
    ready: heading("Crear cuenta"),
    act: async (page) => {
      await page.getByLabel("Tu nombre").fill("L");
      await page.getByLabel("Correo").fill("leo");
      await page.getByLabel("Contraseña").fill("corta");
      await page.getByRole("button", { name: /crear cuenta/i }).click();
      await expect(page.getByText(/al menos 8 caracteres/i)).toBeVisible();
    },
  },
  { slug: "recover-email", path: "/recover", widths: [1280, 375], ready: heading("Recuperar contraseña") },
  {
    slug: "recover-code",
    path: "/recover",
    widths: [1280, 375],
    arrange: (page) => raw(page, "**/auth/email-otp/request-password-reset", 200, {}),
    ready: heading("Recuperar contraseña"),
    act: async (page) => {
      await page.getByLabel("Correo").fill("leo@wifiplus.mx");
      await page.getByRole("button", { name: /enviar código/i }).click();
      await expect(page.getByText(/si existe una cuenta/i)).toBeVisible();
    },
  },
  {
    slug: "wizard-1",
    path: "/nuevo-negocio",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page);
      await fail(page, "**/auth/me", "NO_BUSINESS", 403);
    },
    ready: heading("Crea tu negocio"),
  },
  {
    slug: "wizard-2",
    path: "/nuevo-negocio",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page);
      await fail(page, "**/auth/me", "NO_BUSINESS", 403);
    },
    ready: heading("Crea tu negocio"),
    act: async (page) => {
      await page.getByLabel("Nombre del negocio").fill("WifiPlus");
      await page.getByRole("button", { name: /continuar/i }).click();
      await page.getByLabel("CLABE").fill("646180157000000004");
      await expect(page.getByText("Elige tu banco")).toBeHidden();
    },
  },
  {
    slug: "wizard-3",
    path: "/nuevo-negocio",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page);
      await fail(page, "**/auth/me", "NO_BUSINESS", 403);
      await ok(page, "**/businesses", { ...businessActor, name: "WifiPlus" });
    },
    ready: heading("Crea tu negocio"),
    act: async (page) => {
      await page.getByLabel("Nombre del negocio").fill("WifiPlus");
      await page.getByRole("button", { name: /continuar/i }).click();
      await page.getByLabel("CLABE").fill("646180157000000004");
      await page.getByRole("button", { name: /crear negocio|terminar|listo/i }).click();
      await expect(page.getByRole("heading", { name: /tu negocio está listo/i })).toBeVisible();
    },
  },
  {
    slug: "invitation-signed-out",
    path: "/invitaciones/inv-1",
    widths: [1280, 375],
    arrange: (page) => signedOut(page),
    ready: heading(/te invitaron a un negocio/i),
  },
  {
    slug: "invitation-wrong-email",
    path: "/invitaciones/inv-1",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page, { ...sessionUser, emailVerified: true });
      await raw(page, "**/auth/organization/accept-invitation", 403, {
        code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
      });
    },
    ready: (page) => expect(page.getByText(/fue enviada a otro correo/i)).toBeVisible({ timeout: 15_000 }),
  },
  {
    slug: "invitation-invalid",
    path: "/invitaciones/inv-1",
    widths: [1280],
    arrange: async (page) => {
      await signedIn(page, { ...sessionUser, emailVerified: true });
      await raw(page, "**/auth/organization/accept-invitation", 400, { code: "INVITATION_NOT_FOUND" });
    },
    ready: (page) => expect(page.getByText(/no es válida o ya venció/i)).toBeVisible({ timeout: 15_000 }),
  },
  {
    slug: "suspended",
    path: "/payments",
    widths: [1280, 375],
    arrange: (page) => fail(page, "**/auth/me", "ACCOUNT_SUSPENDED", 403),
    ready: heading("Cuenta suspendida"),
  },
  {
    slug: "choose-business",
    path: "/payments",
    widths: [1280, 375],
    arrange: async (page) => {
      await fail(page, "**/auth/me", "NO_ACTIVE_BUSINESS", 403);
      await raw(page, "**/auth/organization/list", 200, [
        { id: "org-1", name: "WifiPlus" },
        { id: "org-2", name: "Red Norte Internet" },
      ]);
    },
    ready: (page) => expect(page.getByText("Red Norte Internet")).toBeVisible({ timeout: 15_000 }),
  },
  {
    slug: "revoked",
    path: "/payments",
    widths: [1280],
    arrange: async (page) => {
      await fail(page, "**/auth/me", "MEMBERSHIP_REVOKED", 403);
      await raw(page, "**/auth/organization/list", 200, [{ id: "org-2", name: "Red Norte Internet" }]);
    },
    ready: (page) => expect(page.getByText("Red Norte Internet")).toBeVisible({ timeout: 15_000 }),
  },
  {
    /* better-auth D16: the código screen between the account and its session */
    slug: "verify-email",
    path: "/verify-email?email=leo%40wifiplus.mx",
    widths: [1280, 375],
    ready: heading("Confirma tu correo"),
  },
  {
    slug: "team",
    path: "/settings",
    widths: [1280, 375],
    arrange: async (page) => {
      await ok(page, "**/settings", settings);
      await ok(page, "**/businesses/members", members);
    },
    ready: (page) => expect(page.getByText("Carlos Mena")).toBeVisible({ timeout: 15_000 }),
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : 800 });
        await page.emulateMedia({ colorScheme: theme });
        await stubAdminApi(page);
        await ok(page, "**/payments/feed*", feed);
        await shot.arrange?.(page);
        await page.goto(`${ADMIN}${shot.path}`);
        await shot.ready(page);
        await shot.act?.(page);
        await page.waitForTimeout(400);
        const suffix = theme === "dark" ? "-dark" : "";
        await page.screenshot({
          path: `${OUT}/review-identity-${shot.slug}-${width}${suffix}.png`,
          fullPage: true,
        });
      });
    }
  }
}
