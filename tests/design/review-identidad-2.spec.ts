import { expect, test, type Page } from "@playwright/test";
import { ADMIN } from "../../playwright.config";
import { businessActor, feed, stubAdminApi } from "../e2e/stubs";

/* Design-review captures for everything the identity rounds changed in
   the admin since PR #150 (US-S02, US-S04, US-S06, US-S07, US-B01–B03):
   the access pages with `next` and inline validation, the código screen
   (better-auth D16), the name-only wizard and its done screen (business
   D5), the invitation page in its five states (D14), the shell's two
   banners (D5, integrations-hub D10), the share gate on Links, the team
   card with pending invitations and role pickers (D8, D12), the passkey
   list (D18) and the Sesión card (BUG-016).
   passwordless-access T052: the código screen of its own, the recovery and
   the password field left; the código is a step of /login and /signup now,
   and a wrong one is named there. The new person's invitation has two
   steps since D9's amendment (2026-10-03, spec Clarifications Q5): the
   name, then the código sent to the invited address. Run just this file:
   pnpm exec playwright test --config playwright.review.config.ts tests/design/review-identidad-2.spec.ts */

const OUT = ".design/devolada/screenshots";

const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function raw(page: Page, pattern: string, status: number, body: unknown) {
  await page.route(pattern, (route) => {
    if (route.request().resourceType() === "document") return route.fallback();
    return route.fulfill(json(status, body));
  });
}
const fail = (page: Page, pattern: string, code: string, status: number) =>
  raw(page, pattern, status, { success: false, error: { code } });
const ok = (page: Page, pattern: string, data: unknown) => raw(page, pattern, 200, { success: true, data });

const sessionUser = { id: "user-1", name: "Leo Licona", email: "leo@wifiplus.mx", emailVerified: true };
const signedIn = (page: Page, user = sessionUser) =>
  raw(page, "**/auth/get-session", 200, { user, session: { id: "s-1", userId: user.id } });
const signedOut = (page: Page) => raw(page, "**/auth/get-session", 200, null);

const settings = {
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: { clabe: "646180157000000004", bank: "STP", beneficiaryName: "WifiPlus SA de CV", serviceFeeCents: null, effectiveServiceFeeCents: 1500, bankUnknown: false, configured: true },
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
  pending: [
    { id: "inv-live", email: "sofia@wifiplus.mx", role: "viewer", expiresAt: Date.now() + 40 * 3_600_000, expired: false },
    { id: "inv-old", email: "vieja@wifiplus.mx", role: "operator", expiresAt: Date.now() - 3_600_000, expired: true },
  ],
};
const passkeys = [
  { id: "pk-1", name: "iPhone de Leo", createdAt: "2026-08-20T10:00:00.000Z", backedUp: true },
  { id: "pk-2", name: null, createdAt: "2026-09-01T10:00:00.000Z", backedUp: false },
];
const credit = { balanceCents: 30000, feeCents: 1500, capCents: 200000, minTopUpCents: 15000, step: "ok", topUp: null };
const preview = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  businessName: "WifiPlus",
  role: "operator",
  email: "ana@wifiplus.mx",
  hasAccount: false,
  ...over,
});

async function settingsStubs(page: Page) {
  await ok(page, "**/settings", settings);
  await ok(page, "**/businesses/members", members);
  await raw(page, "**/auth/passkey/list-user-passkeys", 200, passkeys);
  await ok(page, "**/credit", credit);
  await ok(page, "**/credit/entries", { entries: [], nextCursor: null });
  await ok(page, "**/credit/top-ups", { topUps: [] });
}

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
const text = (t: RegExp) => async (page: Page) => expect(page.getByText(t).first()).toBeVisible({ timeout: 15_000 });

const shots: Shot[] = [
  { slug: "login", path: "/login?next=%2Flinks", widths: [1280, 768, 375], ready: heading("Iniciar sesión") },
  {
    slug: "signup-errors",
    path: "/signup",
    widths: [1280, 375],
    ready: heading("Crear cuenta"),
    act: async (page) => {
      await page.getByLabel("Tu nombre").fill("L");
      await page.getByLabel("Correo").fill("leo");
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page.getByText(/escribe un correo válido/i)).toBeVisible();
    },
  },
  {
    slug: "code-step",
    path: "/login?next=%2Flinks",
    widths: [1280, 768, 375],
    arrange: (page) => raw(page, "**/auth/email-otp/send-verification-otp", 200, { success: true }),
    ready: heading("Iniciar sesión"),
    act: async (page) => {
      await page.getByLabel("Correo").fill("leo@wifiplus.mx");
      await page.getByRole("button", { name: "Enviar código" }).click();
      await expect(page.getByRole("heading", { name: "Escribe tu código" })).toBeVisible();
    },
  },
  {
    slug: "code-step-error",
    path: "/login",
    widths: [1280, 375],
    arrange: async (page) => {
      await raw(page, "**/auth/email-otp/send-verification-otp", 200, { success: true });
      await raw(page, "**/auth/sign-in/email-otp", 400, { code: "INVALID_OTP" });
    },
    ready: heading("Iniciar sesión"),
    act: async (page) => {
      await page.getByLabel("Correo").fill("leo@wifiplus.mx");
      await page.getByRole("button", { name: "Enviar código" }).click();
      await page.getByRole("button", { name: /reenviar código/i }).click();
      await page.getByLabel("Código").fill("000000");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page.getByText(/no es válido o ya venció/i)).toBeVisible();
    },
  },
  {
    slug: "wizard",
    path: "/nuevo-negocio",
    widths: [1280, 768, 375],
    arrange: async (page) => {
      await signedIn(page);
      await fail(page, "**/auth/me", "NO_BUSINESS", 403);
    },
    ready: heading("Crea tu negocio"),
  },
  {
    slug: "wizard-done",
    path: "/nuevo-negocio",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page);
      await fail(page, "**/auth/me", "NO_BUSINESS", 403);
      await ok(page, "**/businesses", { ...businessActor, name: "WifiPlus", speiConfigured: false });
    },
    ready: heading("Crea tu negocio"),
    act: async (page) => {
      await page.getByLabel("Nombre del negocio").fill("WifiPlus");
      await page.getByRole("button", { name: /crear negocio/i }).click();
      await expect(page.getByRole("heading", { name: /tu negocio está listo/i })).toBeVisible();
    },
  },
  {
    slug: "invitation-new",
    path: "/invitaciones/inv-1",
    widths: [1280, 768, 375],
    arrange: async (page) => {
      await signedOut(page);
      await ok(page, "**/businesses/invitations/*/preview", preview());
    },
    ready: heading(/te invitaron a wifiplus/i),
  },
  {
    /* the second step: the código sent to the invited address, which
       opens only once it was sent (D9 as amended 2026-10-03) */
    slug: "invitation-new-code",
    path: "/invitaciones/inv-1",
    widths: [1280, 768, 375],
    arrange: async (page) => {
      await signedOut(page);
      await ok(page, "**/businesses/invitations/*/preview", preview());
      await raw(page, "**/auth/email-otp/send-verification-otp", 200, { success: true });
    },
    ready: heading(/te invitaron a wifiplus/i),
    act: async (page) => {
      await page.getByLabel("Tu nombre").fill("Ana Torres");
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page.getByText("Te enviamos un código a ana@wifiplus.mx. Vence en 10 minutos.")).toBeVisible();
    },
  },
  {
    slug: "invitation-existing",
    path: "/invitaciones/inv-1",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedOut(page);
      await ok(page, "**/businesses/invitations/*/preview", preview({ hasAccount: true, role: "admin" }));
    },
    ready: heading(/te invitaron a wifiplus/i),
  },
  {
    slug: "invitation-expired",
    path: "/invitaciones/inv-1",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedOut(page);
      await ok(page, "**/businesses/invitations/*/preview", preview({ status: "expired" }));
    },
    ready: text(/venció/i),
  },
  {
    slug: "invitation-gone",
    path: "/invitaciones/inv-1",
    widths: [1280],
    arrange: async (page) => {
      await signedOut(page);
      await ok(page, "**/businesses/invitations/*/preview", preview({ status: "gone" }));
    },
    ready: text(/no es válida|ya no existe|no encontramos/i),
  },
  {
    slug: "invitation-wrong-email",
    path: "/invitaciones/inv-1",
    widths: [1280, 375],
    arrange: async (page) => {
      await signedIn(page);
      await ok(page, "**/businesses/invitations/*/preview", preview());
      await raw(page, "**/auth/organization/accept-invitation", 403, { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" });
    },
    ready: text(/otro correo/i),
  },
  {
    slug: "banners",
    path: "/payments",
    widths: [1280, 768, 375],
    arrange: (page) => ok(page, "**/auth/me", { ...businessActor, speiConfigured: false, integrationConfigured: false }),
    ready: text(/falta la cuenta donde te pagan/i),
  },
  {
    slug: "links-gated",
    path: "/links",
    widths: [1280, 375],
    arrange: (page) => ok(page, "**/auth/me", { ...businessActor, speiConfigured: false }),
    ready: heading(/links/i),
  },
  {
    slug: "settings-owner",
    path: "/settings",
    widths: [1280, 768, 375],
    arrange: settingsStubs,
    ready: (page) => expect(page.getByRole("heading", { name: "Sesión" })).toBeVisible({ timeout: 15_000 }),
  },
  {
    slug: "settings-team",
    path: "/settings#usuarios",
    widths: [1280, 375],
    arrange: settingsStubs,
    ready: text(/sofia@wifiplus\.mx/i),
    act: async (page) => {
      await page.getByRole("combobox", { name: /rol de carlos mena/i }).click();
      await expect(page.getByRole("option", { name: "Administrador" })).toBeVisible();
    },
  },
  {
    slug: "settings-viewer",
    path: "/settings",
    widths: [1280, 375],
    arrange: async (page) => {
      await settingsStubs(page);
      await ok(page, "**/auth/me", { ...businessActor, role: "viewer" });
    },
    ready: (page) => expect(page.getByRole("heading", { name: "Sesión" })).toBeVisible({ timeout: 15_000 }),
  },
  {
    slug: "suspended",
    path: "/payments",
    widths: [1280, 375],
    arrange: async (page) => {
      await fail(page, "**/auth/me", "ACCOUNT_SUSPENDED", 403);
      await ok(page, "**/support", { whatsapp: "5215512345678", email: "hola@devolada.app" });
    },
    ready: heading("Cuenta suspendida"),
  },
  {
    slug: "choose-business",
    path: "/payments",
    widths: [375],
    arrange: async (page) => {
      await fail(page, "**/auth/me", "NO_ACTIVE_BUSINESS", 403);
      await raw(page, "**/auth/organization/list", 200, [
        { id: "org-1", name: "WifiPlus" },
        { id: "org-2", name: "Red Norte Internet" },
      ]);
    },
    ready: text(/red norte internet/i),
  },
];

for (const shot of shots) {
  const primary = shot.widths[0];
  for (const width of shot.widths) {
    for (const theme of width === primary ? (["light", "dark"] as const) : (["light"] as const)) {
      test(`${shot.slug} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width < 500 ? 812 : width < 1000 ? 1024 : 800 });
        await page.emulateMedia({ colorScheme: theme });
        await stubAdminApi(page);
        await ok(page, "**/payments/feed*", feed);
        await shot.arrange?.(page);
        await page.goto(`${ADMIN}${shot.path}`);
        await shot.ready(page);
        await shot.act?.(page);
        await page.waitForTimeout(400);
        const suffix = theme === "dark" ? "-dark" : "";
        await page.screenshot({ path: `${OUT}/review-identidad2-${shot.slug}-${width}${suffix}.png`, fullPage: true });
      });
    }
  }
}
