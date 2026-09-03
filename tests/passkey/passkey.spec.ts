import { expect, test } from "@playwright/test";

/* US-S07, better-auth.spec.md scenario 9: enrolment stores a credential;
   sign-in with it creates a session. Chromium's virtual authenticator
   plays the device — resident key, user verification on. */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";

test("US-S07: enrol a passkey, sign out, sign in with one touch", async ({ page }) => {
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

  /* Password login first: enrolment needs a session */
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Correo").fill("demo@devolada.app");
  await page.getByLabel("Contraseña").fill("devolada123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();

  /* Enrol on this "device": the passkey card is Cuenta's security
     sub-page since the account hub (US-A05 D4) — reached through the
     avatar and its row, the way a person does */
  await page.getByRole("link", { name: "Cuenta" }).first().click();
  await page.getByRole("link", { name: /entrar con huella o rostro/i }).click();
  await page.getByRole("button", { name: /activar en este dispositivo/i }).click();
  await expect(page.getByText(/ya puede entrar con huella o rostro/i)).toBeVisible();
  /* D18: the credential is listed, with its Quitar */
  const devices = page.getByRole("list", { name: /dispositivos con acceso/i });
  await expect(devices.getByRole("listitem")).toHaveCount(1);
  await expect(devices.getByRole("button", { name: /quitar/i })).toBeVisible();

  /* Sign out from the hub's door (BUG-016: the one that exists at every
     width, now in Cuenta's rail), then back in with the passkey alone */
  await page.getByRole("button", { name: /cerrar sesión/i }).last().click();
  await expect(page.getByLabel("Correo")).toBeVisible();

  await page.getByRole("button", { name: /entrar con huella o rostro/i }).click();
  await expect(page.getByRole("heading", { name: "Pagos" })).toBeVisible();
});
