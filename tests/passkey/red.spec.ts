import { expect, request, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createStoreResponse } from "../../apps/api/src/routes/platform/schema";

/* cash-at-stores US3 (FR-010, FR-011; research D3, D26) and
   passwordless-access US6 (D7, D10, D14; FR-031–FR-036): on red's own
   origin, against the real API, and no password anywhere —

   1. the operator, the demo address, gets in by código and creates a store;
   2. the invitation opens in a fresh context whose virtual authenticator
      plays a device that can verify the person (D7);
   3. an email and its código accept it, the activation turns on *huella o
      rostro*, and the counter opens;
   4. signed out, the key alone lets the shopkeeper back in;
   5. signed out again, the phone and a código sent to the store's email
      let them in too — the way in for a phone without its key (FR-033).

   Códigos are hashed (D2), so the journey mints each one with
   `POST /dev/code` (D14), replacing the live código the API just sent, as
   the email would carry it. */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";
const RED = "http://localhost:5177";

/* What the código email would carry: a fresh código for a test address */
async function devCode(browser: Browser, email: string): Promise<string> {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${API}/dev/code`, { data: { email, type: "sign-in" } });
  const { code } = ((await res.json()) as { data: { code: string } }).data;
  await ctx.close();
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

/* Types what the email would carry and presses "Entrar", until `next`
   shows. The phone door answers before its own send has landed (the API
   defers it past the answer, so a stranger's phone and a store's answer
   alike: FR-033), and that send deletes the address's código before
   writing its own. A mint that lands first is wiped, and the código typed
   is refused. The refusal comes a whole round trip later, with the send
   long done, so one more mint holds (adversarial review, 2026-10-02). The
   invitation door awaits its send, and needs no second try. */
async function enterMintedCode(page: Page, browser: Browser, email: string, next: Locator) {
  const refused = page.getByText("El código no es válido o ya venció. Pide uno nuevo.");
  await page.getByLabel("Código").fill(await devCode(browser, email));
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(next.or(refused)).toBeVisible();
  if (await refused.isVisible()) {
    await page.getByLabel("Código").fill(await devCode(browser, email));
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  }
  await expect(next).toBeVisible();
}

/* A device with a built-in authenticator that verifies the person */
async function withAuthenticator(page: Page) {
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
}

/* Caja holds the sign-out. The journey's browser is a computer (1280 px),
   so the sections are the side menu (cash-at-stores D32). */
async function signOut(page: Page) {
  await page.getByRole("navigation", { name: "Secciones", exact: true }).getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.getByLabel("Tu teléfono")).toBeVisible();
}

test("passwordless-access US6: a shopkeeper accepts by email and código, turns on the key, and gets back in by key and by phone", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  /* a phone no other store or user holds: ten digits, 55 + eight */
  const phone = `55${String(Date.now()).slice(-8)}`;
  const email = `tienda-${stamp}@journey.invalid`;

  /* 1. The operator, by API: the demo account (this harness's operator)
     gets in by código from the panel's origin and creates the store */
  const operator = await request.newContext({ baseURL: API, extraHTTPHeaders: { Origin: ADMIN } });
  expect((await operator.post("/dev/seed")).ok()).toBe(true);
  const minted = await operator.post("/dev/code", { data: { email: "demo@devolada.app", type: "sign-in" } });
  const { code: operatorCode } = ((await minted.json()) as { data: { code: string } }).data;
  const signIn = await operator.post("/auth/sign-in/email-otp", { data: { email: "demo@devolada.app", otp: operatorCode } });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const created = await operator.post("/platform/stores", {
    data: { name: `Tienda ${stamp}`, address: "Calle de Prueba 1, Centro", shopkeeperName: "Tendero de Prueba", phone },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { invitation } = createStoreResponse.parse((await created.json()).data);
  /* RED_BASE_URL in the local config is this origin (cash-at-stores D4) */
  expect(invitation.url.startsWith(`${RED}/invitacion/`)).toBe(true);
  await operator.dispose();

  /* 2. The invitation, in a fresh context: the shopkeeper's own device */
  const page = await (await browser.newContext()).newPage();
  await withAuthenticator(page);
  await page.goto(invitation.url);
  await expect(page.getByRole("heading", { name: `Bienvenido a Devolada, Tienda ${stamp}` })).toBeVisible();
  /* spec Clarifications, Q4: no line about passwords */
  await expect(page.getByText(/contraseña/i)).toHaveCount(0);

  /* 3. The email, its código, the activation, then the counter (D10) */
  await page.getByLabel("Tu correo").fill(email);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(`Te enviamos un código a ${email}. Vence en 10 minutos.`)).toBeVisible();
  await page.getByLabel("Código").fill(await devCode(browser, email));
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).toBeVisible();
  await page.getByRole("button", { name: "Activar huella o rostro" }).click();
  await expect(page.getByText("Listo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();

  /* Caja lists the key, named "Tienda" (D10; FR-036) */
  await page.getByRole("navigation", { name: "Secciones", exact: true }).getByRole("link", { name: "Caja" }).click();
  await expect(page.getByRole("list", { name: "Dispositivos con acceso" })).toContainText("Tienda");

  /* 4. Signed out, back in with the key alone (FR-011) */
  await signOut(page);
  await page.getByRole("button", { name: "Entrar con huella o rostro" }).click();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();

  /* 5. Signed out, the phone and a código at the store's email (FR-033):
     the screen names no address, so the same line reads for every phone */
  await signOut(page);
  await page.getByLabel("Tu teléfono").fill(`${phone.slice(0, 2)} ${phone.slice(2, 6)} ${phone.slice(6)}`);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(
    page.getByText("Si ese teléfono es de una tienda, te enviamos un código al correo de la tienda. Vence en 10 minutos."),
  ).toBeVisible();
  /* The device can verify the person, so the código door offers the key
     again (D7); this one already holds it, and "Ahora no" goes on */
  await enterMintedCode(page, browser, email, page.getByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" }));
  await page.getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();
});
