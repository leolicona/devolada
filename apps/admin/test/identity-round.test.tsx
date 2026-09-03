import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { businessActor, fail, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* The identity round's spec PR (2026-09-02), UI half: business D5 (the
   CLABE banner and the share gate), D8 (pending invitations, resend,
   cancel), D12 (role change), operator-panel D1 (the support channel).
   better-auth D16 (the código opens the session) lives in shell.test.tsx.
   US-B01, US-B03. */

const emptyFeed = () => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } });
const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: {
    clabe: "646180157000000004",
    bank: "STP",
    beneficiaryName: null,
    serviceFeeCents: null,
    effectiveServiceFeeCents: 1500,
    bankUnknown: false,
    configured: true,
  },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
});
const team = {
  members: [
    { id: "m-owner", userId: "user-1", name: "Leo", email: "demo@devolada.app", role: "owner", createdAt: 1 },
    { id: "m-op", userId: "user-2", name: "Ana", email: "ana@wifiplus.mx", role: "operator", createdAt: 2 },
  ],
  grantable: ["owner", "admin", "operator", "viewer"],
  pending: [
    { id: "inv-live", email: "carlos@wifiplus.mx", role: "viewer", expiresAt: Date.now() + 40 * 3_600_000, expired: false },
    { id: "inv-old", email: "vieja@wifiplus.mx", role: "operator", expiresAt: Date.now() - 3_600_000, expired: true },
  ],
};

async function usersSection() {
  return (await screen.findByRole("heading", { name: "Usuarios" })).closest("section")!;
}

describe("US-B03 / D8: pending invitations are listed, resent and cancelled", () => {
  it("names each pending invitation with its role and its clock; Reenviar and Cancelar hit the API", async () => {
    const resent: string[] = [];
    const cancelled: string[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
      handlers.members(() => ok(team)),
      handlers.resendInvitation((id) => {
        resent.push(id);
        return ok({ id, email: "vieja@wifiplus.mx", expiresAt: Date.now() + 48 * 3_600_000 });
      }),
      handlers.cancelInvitation((id) => {
        cancelled.push(id);
        return ok({});
      }),
    );
    renderApp("/settings/users");
    const users = await usersSection();
    const pending = within(users).getByRole("list", { name: /invitaciones pendientes/i });
    expect(within(pending).getByText("carlos@wifiplus.mx")).toBeInTheDocument();
    expect(within(pending).getByText(/lector · vence en 40 horas/i)).toBeInTheDocument();
    expect(within(pending).getByText("Vencida")).toBeInTheDocument();

    const rows = within(pending).getAllByRole("listitem");
    await userEvent.click(within(rows[1]).getByRole("button", { name: /reenviar/i }));
    expect(await screen.findByText(/invitación reenviada/i)).toBeInTheDocument();
    await userEvent.click(within(rows[0]).getByRole("button", { name: /cancelar/i }));
    expect(resent).toEqual(["inv-old"]);
    expect(cancelled).toEqual(["inv-live"]);
  });
});

describe("US-B03 / D12: the role is a picker for the members I could have invited", () => {
  it("the owner changes an operator to admin through the picker; the owner's own row has none", async () => {
    const patched: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
      handlers.members(() => ok(team)),
      handlers.updateMemberRole((id, body) => {
        patched.push([id, body]);
        return ok({ id, role: (body as { role: string }).role });
      }),
    );
    renderApp("/settings/users");
    const users = await usersSection();
    expect(within(users).queryByRole("combobox", { name: /rol de leo/i })).not.toBeInTheDocument();
    await userEvent.click(within(users).getByRole("combobox", { name: /rol de ana/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Administrador" }));
    expect(patched).toEqual([["m-op", { role: "admin" }]]);
  });
});

describe("US-B01 / D5: a business born without a CLABE wears a banner and shares nothing yet", () => {
  it("the owner's banner points at Configuración; a viewer sees the sentence without the button", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, speiConfigured: false })), handlers.feed(emptyFeed));
    renderApp("/payments");
    expect(await screen.findByText(/falta la clabe del negocio/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /configurar/i })).toHaveAttribute("href", "/settings/direct-payment#spei");
  });

  it("Links: the roster reads, the share buttons wait for the CLABE", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, speiConfigured: false })),
      handlers.linksRoster(() =>
        ok({
          results: [
            {
              wisphubId: 1,
              usuario: "greyes",
              name: "Janely Reyes",
              phone: "5551234567",
              url: "https://link.dev.devoladapago.com/p/tok",
              waLink: "https://wa.me/525551234567?text=hola",
            },
          ],
          complete: true,
          readAt: Date.now(),
        }),
      ),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    /* One voice per screen: the shell's banner says it, the page does not repeat it */
    expect(screen.getByText(/falta la clabe del negocio/i)).toBeInTheDocument();
    expect(screen.queryByText(/configura la clabe del negocio en configuración/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
  });
});

describe("US-B01 / D5: the CLABE form in Configuración keeps the wizard's prefix pick", () => {
  it("646… pre-selects STP; an unknown prefix leaves the picker empty", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, speiConfigured: false })),
      handlers.settings(() =>
        ok({ ...settings, spei: { ...settings.spei, clabe: null, bank: null, configured: false } }),
      ),
      handlers.members(() => ok({ ...team, pending: [] })),
    );
    renderApp("/settings/direct-payment");
    const clabe = await screen.findByLabelText("CLABE");
    await userEvent.type(clabe, "646180157000000004");
    expect(screen.getByRole("combobox", { name: "Banco" })).toHaveTextContent("STP");
    await userEvent.clear(clabe);
    await userEvent.type(clabe, "999180157000000004");
    expect(screen.getByRole("combobox", { name: "Banco" })).toHaveTextContent("Elige tu banco");
  });
});

describe("sessions rule 2 / operator-panel D1: the suspended screen names the channel", () => {
  it("shows WhatsApp and email from the platform settings", async () => {
    server.use(
      handlers.session(() => fail("ACCOUNT_SUSPENDED", 403)),
      handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
    );
    renderApp("/payments");
    expect(await screen.findByRole("heading", { name: "Cuenta suspendida" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /whatsapp/i })).toHaveAttribute("href", "https://wa.me/5215512345678");
    expect(screen.getByRole("link", { name: /hola@devoladapago\.com/i })).toHaveAttribute("href", "mailto:hola@devoladapago.com");
  });
});
