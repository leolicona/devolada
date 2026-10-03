import { expect, test, type Page } from "@playwright/test";

/* US-S07, better-auth.spec.md scenario 9: enrolment stores a credential;
   sign-in with it creates a session. Chromium's virtual authenticator
   plays the device — resident key, user verification on.

   passwordless-access US2 (D1, D6, D14): no password. The demo signs in
   with a código — minted by `POST /dev/code`, since códigos are stored
   hashed (D2) — and /welcome offers the key at once, on a device that can
   verify the person (D7). A removed key stops at once, and the código
   still opens the account (FR-023, analysis G2). */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";
const DEMO = "demo@devolada.app";

async function signInByCode(page: Page) {
  await page.getByLabel("Correo").fill(DEMO);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("heading", { name: "Escribe tu código" })).toBeVisible();
  const minted = await page.request.post(`${API}/dev/code`, { data: { email: DEMO, type: "sign-in" } });
  const { code } = ((await minted.json()) as { data: { code: string } }).data;
  await page.getByLabel("Código").fill(code);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

async function toSecurity(page: Page) {
  /* The keys card is Cuenta's security sub-page since the account hub
     (US-A05 D4) — reached through the avatar and its row, the way a
     person does */
  await page.getByRole("link", { name: "Cuenta" }).first().click();
  await page.getByRole("link", { name: /entrar con huella o rostro/i }).click();
}

async function signOut(page: Page) {
  /* the hub's door (BUG-016: the one that exists at every width) — not
     the card's "Cerrar sesión en los demás dispositivos" */
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).last().click();
  await expect(page.getByLabel("Correo")).toBeVisible();
}

test("passwordless-access US2: a código, the key on /welcome, sign out, sign in with one touch; a removed key stops at once", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.request.post(`${API}/dev/seed`);

  /* The código first; /welcome offers the key right after it */
  await page.goto(`${ADMIN}/login`);
  await signInByCode(page);
  await expect(page.getByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).toBeVisible();
  await page.getByRole("button", { name: "Activar huella o rostro" }).click();
  await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();

  /* D18: the key is listed, with its Quitar */
  await toSecurity(page);
  const devices = page.getByRole("list", { name: /dispositivos con acceso/i });
  await expect(devices.getByRole("listitem").first()).toBeVisible();
  await expect(devices.getByRole("button", { name: /quitar/i }).first()).toBeVisible();

  /* Sign out, then back in with the key alone (FR-011) */
  await signOut(page);
  await page.getByRole("button", { name: "Entrar con huella o rostro" }).click();
  await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();

  /* A removed key stops at once (FR-023): every key of the demo goes —
     counted once the list has loaded, never while it is still on its way */
  await toSecurity(page);
  await expect(devices.getByRole("listitem").first()).toBeVisible();
  while ((await devices.getByRole("listitem").count()) > 0) {
    const before = await devices.getByRole("listitem").count();
    await devices.getByRole("button", { name: /quitar/i }).first().click();
    await expect(devices.getByRole("listitem")).toHaveCount(before - 1);
  }
  await expect(page.getByText("Ningún dispositivo tiene acceso con huella o rostro todavía.")).toBeVisible();
  await signOut(page);

  await page.getByRole("button", { name: "Entrar con huella o rostro" }).click();
  await expect(page.getByText("No pudimos usar tu huella o rostro. Entra con un código.")).toBeVisible();

  /* …and the código still opens the account */
  await signInByCode(page);
  await page.getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();
});
