import { expect, request, test } from "@playwright/test";
import { createStoreResponse } from "../../apps/api/src/routes/platform/schema";

/* cash-at-stores US3 (FR-010, FR-011; research D3, D5, D26): on red's own
   origin, against the real API — the operator creates a store; the
   shopkeeper accepts the invitation with an email and a password, types
   the código, lands on the counter, turns on *huella o rostro* in Caja,
   signs out, and signs back in with the passkey alone. Chromium's virtual
   authenticator plays the phone. */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";
const RED = "http://localhost:5177";

test("cash-at-stores US3: a shopkeeper accepts, enrols a passkey on red, and signs in with it", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  /* a phone no other store or user holds: ten digits, 55 + eight */
  const phone = `55${String(Date.now()).slice(-8)}`;
  const email = `tienda-${stamp}@journey.invalid`;

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

  /* The operator, by API: the demo account (this harness's operator)
     signs in from the panel's origin and creates the store */
  const operator = await request.newContext({ baseURL: API, extraHTTPHeaders: { Origin: ADMIN } });
  expect((await operator.post("/dev/seed")).ok()).toBe(true);
  const signIn = await operator.post("/auth/sign-in/email", { data: { email: "demo@devolada.app", password: "devolada123" } });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const created = await operator.post("/platform/stores", {
    data: { name: `Tienda ${stamp}`, address: "Calle de Prueba 1, Centro", shopkeeperName: "Tendero de Prueba", phone },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { invitation } = createStoreResponse.parse((await created.json()).data);
  /* RED_BASE_URL in the local config is this origin (D4) */
  expect(invitation.url.startsWith(`${RED}/invitacion/`)).toBe(true);
  await operator.dispose();

  /* The invitation's two steps */
  await page.goto(invitation.url);
  await expect(page.getByRole("heading", { name: `Bienvenido a Devolada, Tienda ${stamp}` })).toBeVisible();
  await page.getByLabel("Correo de recuperación").fill(email);
  await page.getByLabel("Contraseña").fill("tienda-clave-1");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(`Te enviamos un código a ${email}`)).toBeVisible();

  const reader = await browser.newContext();
  const res = await reader.request.get(`${API}/dev/last-code?email=${encodeURIComponent(email)}`);
  const { code } = ((await res.json()) as { data: { code: string | null } }).data;
  await reader.close();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("Código").fill(code!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();

  /* Caja holds the passkey card (`cashbox` D3) */
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Activar huella o rostro" }).click();
  await expect(page.getByText("Listo. La próxima vez entra con tu huella o rostro.")).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByLabel("Teléfono")).toBeVisible();

  /* Back in with the passkey alone */
  await page.getByRole("button", { name: "Entrar con huella o rostro" }).click();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();

  /* and the phone with its password still works (D3: the passkey is
     offered, never forced) */
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByLabel("Teléfono").fill(`${phone.slice(0, 2)} ${phone.slice(2, 6)} ${phone.slice(6)}`);
  await page.getByLabel("Contraseña").fill("tienda-clave-1");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cobrar" })).toBeVisible();
});
