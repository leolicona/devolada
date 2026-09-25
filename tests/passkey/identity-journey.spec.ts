import { expect, test, type Browser } from "@playwright/test";

/* The identity journey, end to end against the real API (wrangler + D1,
   same harness as the passkey ceremony): signup → the código opens the
   session → the one-step wizard → the CLABE in Pago directo → an
   invitation → the invitee creates a password on the invitation page and
   lands inside → the owner changes the role, then removes the member →
   the member's next request is named a revoked membership.
   business-and-memberships D5, D8, D11, D12; better-auth D14, D16
   (US-B01, US-B03, US-S04). */

const API = "http://localhost:8794";
const ADMIN = "http://localhost:5174";
const PASSWORD = "devolada123";

async function devRead<T>(browser: Browser, path: string): Promise<T> {
  const ctx = await browser.newContext();
  const res = await ctx.request.get(`${API}${path}`);
  const json = (await res.json()) as { data: T };
  await ctx.close();
  return json.data;
}

test("US-B01/US-B03: signup, verify, name the business, add the CLABE, invite, accept with a password, change role, remove", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const owner = `owner-${stamp}@journey.invalid`;
  const invitee = `ana-${stamp}@journey.invalid`;

  const ownerPage = await (await browser.newContext()).newPage();

  /* Registration is not onboarding: account, then a name, then the missing step named */
  await ownerPage.goto(`${ADMIN}/signup`);
  await ownerPage.getByLabel("Tu nombre").fill("Leo Journey");
  await ownerPage.getByLabel("Correo").fill(owner);
  await ownerPage.getByLabel("Contraseña").fill(PASSWORD);
  await ownerPage.getByRole("button", { name: /crear cuenta/i }).click();

  /* The código is the door (better-auth D16): nothing of the app before it */
  await expect(ownerPage.getByRole("heading", { name: /confirma tu correo/i })).toBeVisible();
  await expect(ownerPage.getByText(new RegExp(`enviamos a ${owner}`, "i"))).toBeVisible();
  const { code } = await devRead<{ code: string }>(browser, `/dev/last-code?email=${encodeURIComponent(owner)}`);
  expect(code).toMatch(/^\d{6}$/);
  await ownerPage.getByLabel("Código").fill(code);
  await ownerPage.getByRole("button", { name: /^confirmar$/i }).click();

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

  /* The invitee: one form, the address fixed, a password — inside as operator */
  const { id } = await devRead<{ id: string }>(browser, `/dev/last-invitation?email=${encodeURIComponent(invitee)}`);
  expect(id).toBeTruthy();
  const inviteePage = await (await browser.newContext()).newPage();
  await inviteePage.goto(`${ADMIN}/invitaciones/${id}`);
  await expect(inviteePage.getByRole("heading", { name: new RegExp(`te invitaron a wifiplus ${stamp}`, "i") })).toBeVisible();
  await expect(inviteePage.getByText(/como operador\. crea tu contraseña/i)).toBeVisible();
  await expect(inviteePage.getByText(invitee)).toBeVisible();
  await inviteePage.getByLabel("Tu nombre").fill("Ana Journey");
  await inviteePage.getByLabel(/crea tu contraseña/i).fill(PASSWORD);
  await inviteePage.getByRole("button", { name: /crear cuenta y entrar/i }).click();
  await expect(inviteePage.getByRole("heading", { name: "Pagos" })).toBeVisible();
  await expect(inviteePage.getByText("Operador").first()).toBeVisible();
  /* Born verified: no código screen for the invitee */
  await expect(inviteePage.getByRole("heading", { name: /confirma tu correo/i })).toHaveCount(0);

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
});
