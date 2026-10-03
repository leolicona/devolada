import { expect, test, type Browser, type Page } from "@playwright/test";

/* The identity journey, end to end against the real API (wrangler + D1,
   same harness as the passkey ceremony): signup → the código opens the
   session → the one-step wizard → the CLABE in Pago directo → an
   invitation → the invitee lands inside → the owner changes the role,
   then removes the member → the member's next request is named a revoked
   membership.
   business-and-memberships D5, D8, D11, D12; better-auth D14, D16
   (US-B01, US-B03, US-S04).

   passwordless-access US1, US4: no password anywhere. The owner registers
   with a name, an email and its código, and turns on the key on /welcome;
   the invitee gives a name and the código sent to the invited address —
   the invitation's id proves nothing, the owner holds it too (D9 as
   amended 2026-10-03, spec Clarifications Q5), so six other digits are
   refused first and birth nothing — then the key; a second
   invitation, to an account that holds a key, is accepted with the key
   alone. Códigos are hashed (D2), so the journey mints one with
   `POST /dev/code` (D14). Each person has their own context, with its own
   virtual authenticator: a device that can verify the person (D7). */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";

async function devRead<T>(browser: Browser, path: string): Promise<T> {
  const ctx = await browser.newContext();
  const res = await ctx.request.get(`${API}${path}`);
  const json = (await res.json()) as { data: T };
  await ctx.close();
  return json.data;
}

/* What the código email would carry: a fresh código for a test address */
async function devCode(browser: Browser, email: string): Promise<string> {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${API}/dev/code`, { data: { email, type: "sign-in" } });
  const { code } = ((await res.json()) as { data: { code: string } }).data;
  await ctx.close();
  expect(code).toMatch(/^\d{6}$/);
  return code;
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

test("US-B01/US-B03, passwordless-access US1, US4: register by código, turn on the key, name the business, add the CLABE, invite, join by name, código and key, change role, remove", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const owner = `owner-${stamp}@journey.invalid`;
  const invitee = `ana-${stamp}@journey.invalid`;

  const ownerPage = await (await browser.newContext()).newPage();
  await withAuthenticator(ownerPage);

  /* Registration is not onboarding: account, then a name, then the missing step named */
  await ownerPage.goto(`${ADMIN}/signup`);
  await ownerPage.getByLabel("Tu nombre").fill("Leo Journey");
  await ownerPage.getByLabel("Correo").fill(owner);
  await ownerPage.getByRole("button", { name: "Continuar" }).click();

  /* The código is the door (passwordless-access D1): nothing of the app before it */
  await expect(ownerPage.getByRole("heading", { name: "Escribe tu código" })).toBeVisible();
  await expect(ownerPage.getByText(new RegExp(`a ${owner}\\. Vence en 10 minutos`, "i"))).toBeVisible();
  await ownerPage.getByLabel("Código").fill(await devCode(browser, owner));
  await ownerPage.getByRole("button", { name: "Crear cuenta" }).click();

  /* /welcome: this device can verify the person, so the key is offered (D7) */
  await expect(ownerPage.getByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Activar huella o rostro" }).click();
  await expect(ownerPage.getByText("Listo.")).toBeVisible();

  await expect(ownerPage.getByRole("heading", { name: /crea tu negocio/i })).toBeVisible();
  await ownerPage.getByLabel("Nombre del negocio").fill(`WifiPlus ${stamp}`);
  await ownerPage.getByRole("button", { name: /crear negocio/i }).click();
  await expect(ownerPage.getByRole("heading", { name: /tu negocio está listo/i })).toBeVisible();
  await ownerPage.getByRole("button", { name: /configurar mi clabe/i }).click();

  /* The shell wears the account banner until the SPEI card closes it
     (worded for any account since receipt-triage D32) */
  await expect(ownerPage.getByText(/falta la cuenta donde te pagan/i)).toBeVisible();
  await ownerPage.getByLabel("CLABE").fill("646180157000000004");
  /* bug: bank-picker-unreachable — the picker is a combobox now, so the
     name the CLABE seeded is the field's value, not text beside it. */
  /* exact since receipt-triage US3: the card and the phone have bank
     pickers of their own */
  await expect(ownerPage.getByRole("combobox", { name: "Banco", exact: true })).toHaveValue(/STP/);
  await ownerPage.getByRole("button", { name: /guardar pago directo/i }).click();
  await expect(ownerPage.getByText(/guardado|listo|actualizad/i).first()).toBeVisible({ timeout: 10_000 });
  await ownerPage.reload();
  /* settings D11: the page the wizard lands on is Pago directo y
     conciliación — "Configuración" was one page naming three subjects */
  await expect(ownerPage.getByRole("heading", { name: "Pago directo y conciliación" })).toBeVisible();
  await expect(ownerPage.getByText(/falta la cuenta donde te pagan/i)).toHaveCount(0);

  /* Invite (verified by construction — the session exists), and the
     pending list shows the clock. Usuarios is a sub-page of Cuenta since
     the account hub (US-A05 D4): travel there through the avatar and the
     row, the way a person does (TESTING rule 9). */
  await ownerPage.getByRole("link", { name: "Cuenta" }).first().click();
  await ownerPage.getByRole("link", { name: /^usuarios/i }).click();
  const users = ownerPage.getByRole("region", { name: "Usuarios" });
  await users.getByLabel(/invitar por correo/i).fill(invitee);
  await users.getByRole("combobox", { name: "Rol" }).click();
  await ownerPage.getByRole("option", { name: "Operador" }).click();
  await users.getByRole("button", { name: /^invitar$/i }).click();
  await expect(ownerPage.getByText(new RegExp(`invitación enviada a ${invitee}`, "i"))).toBeVisible();
  await expect(users.getByRole("list", { name: /invitaciones pendientes/i })).toContainText(/vence en/i);

  /* The invitee: the address fixed, a name, the código sent to the invited
     address, the key — inside as operator. No password (passwordless-access
     D9 as amended 2026-10-03, US4 scenario 4). */
  const { id } = await devRead<{ id: string }>(browser, `/dev/last-invitation?email=${encodeURIComponent(invitee)}`);
  expect(id).toBeTruthy();
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await withAuthenticator(inviteePage);
  await inviteePage.goto(`${ADMIN}/invitaciones/${id}`);
  await expect(inviteePage.getByRole("heading", { name: new RegExp(`te invitaron a wifiplus ${stamp}`, "i") })).toBeVisible();
  await expect(inviteePage.getByText(/como operador\./i)).toBeVisible();
  await expect(inviteePage.getByText(invitee)).toBeVisible();
  await expect(inviteePage.getByLabel(/contraseña/i)).toHaveCount(0);
  await inviteePage.getByLabel("Tu nombre").fill("Ana Journey");
  await inviteePage.getByRole("button", { name: "Continuar" }).click();
  /* The código step opens only once the page's own send answered, and the
     plugin stores the código before it answers — only the email waits
     (better-auth 1.6.29 `resolveOTP`). So one mint after the step opens is
     the live código, as on the owner's /signup above: no second try, which
     would hide a page that sent again behind the person's back */
  await expect(inviteePage.getByText(`Te enviamos un código a ${invitee}. Vence en 10 minutos.`)).toBeVisible();
  const code = await devCode(browser, invitee);
  /* Six digits that are not the inbox's open nothing: the real server
     refuses them, the real page says so, and no account is born
     (passwordless-access US4 scenario 7, spec Clarifications Q5). One
     wrong try stays under the plugin's three and the door's five a minute */
  await inviteePage.getByLabel("Código").fill(code.replace(/\d$/, (d) => String((Number(d) + 1) % 10)));
  await inviteePage.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(inviteePage.getByText("El código no es válido o ya venció. Reenvíalo e intenta otra vez.")).toBeVisible();
  expect(
    await devRead<{ status: string; hasAccount: boolean }>(browser, `/businesses/invitations/${id}/preview`),
  ).toMatchObject({ status: "pending", hasAccount: false });
  await inviteePage.getByLabel("Código").fill(code);
  await inviteePage.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(inviteePage.getByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).toBeVisible();
  await inviteePage.getByRole("button", { name: "Activar huella o rostro" }).click();
  await expect(inviteePage.getByRole("heading", { name: "Pagos" })).toBeVisible();
  await expect(inviteePage.getByText("Operador").first()).toBeVisible();
  /* The código proved the inbox: the account was born verified and named
     (passwordless-access D9 as amended 2026-10-03, FR-019). The context's
     request carries the page's cookies; the session cookie is localhost's,
     whatever the port */
  const born = (await (await inviteeContext.request.get(`${API}/auth/get-session`)).json()) as {
    user: { email: string; name: string; emailVerified: boolean };
  };
  expect(born.user).toMatchObject({ email: invitee, name: "Ana Journey", emailVerified: true });

  /* The owner changes the role without re-inviting, then removes */
  await ownerPage.reload();
  await expect(users.getByText("Ana Journey")).toBeVisible();
  await users.getByRole("combobox", { name: /rol de ana journey/i }).click();
  await ownerPage.getByRole("option", { name: "Administrador" }).click();
  await expect(users.getByRole("combobox", { name: /rol de ana journey/i })).toHaveText(/Administrador/);

  await users.getByRole("button", { name: /^quitar$/i }).click();
  await ownerPage.getByRole("button", { name: /^quitar$/i }).last().click();
  await expect(users.getByText("Ana Journey")).toHaveCount(0);

  /* The removed member's next request is named for what it is */
  await inviteePage.reload();
  await expect(inviteePage.getByText(/ya no formas parte del negocio/i)).toBeVisible();

  /* A second invitation, to an account that holds a key: signed out, the
     page offers the key, and the key alone accepts (FR-017) */
  await users.getByLabel(/invitar por correo/i).fill(invitee);
  await users.getByRole("combobox", { name: "Rol" }).click();
  await ownerPage.getByRole("option", { name: "Operador" }).click();
  await users.getByRole("button", { name: /^invitar$/i }).click();
  await expect(ownerPage.getByText(new RegExp(`invitación enviada a ${invitee}`, "i"))).toBeVisible();
  const again = await devRead<{ id: string }>(browser, `/dev/last-invitation?email=${encodeURIComponent(invitee)}`);
  expect(again.id).not.toBe(id);
  await inviteeContext.clearCookies();
  await inviteePage.goto(`${ADMIN}/invitaciones/${again.id}`);
  await inviteePage.getByRole("button", { name: "Entrar con huella o rostro" }).click();
  await expect(inviteePage.getByRole("heading", { name: "Pagos" })).toBeVisible();
  await expect(inviteePage.getByText("Operador").first()).toBeVisible();
});
