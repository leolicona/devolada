import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/account-hub.spec.md scenarios 1, 2, 4, 5, 6 (US-A05).
   Scenario 3 lives in session-round.test.tsx (BUG-016), 8 in a11y.test.tsx. */

const feed = feedResponse.parse({ payments: [], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 0, totalCents: 0, startedAtMs: 0 } });
const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: { clabe: "646180157000000004", bank: "STP", beneficiaryName: null, serviceFeeCents: null, effectiveServiceFeeCents: 1500, bankUnknown: false, configured: true },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
});
const credit = { balanceCents: 10000, feeCents: 800, step: "ok", capCents: -5000, minTopUpCents: 10000, topUp: null };

describe("US-A05 scenario 1: the fifth section is the avatar, labelled Cuenta, and it opens the hub", () => {
  it("shows the initials in both navs; tapping Cuenta from Pagos lands on the hub (TESTING rule 9)", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.feed(() => ok(feed)));
    const router = renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });

    const items = screen.getAllByRole("link", { name: "Cuenta" });
    expect(items).toHaveLength(2); /* sidebar + bottom bar */
    for (const item of items) expect(within(item).getByText("LL")).toBeInTheDocument();
    /* The gear is gone, and so is the sidebar's own door */
    expect(screen.queryByRole("link", { name: "Configuración" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cerrar sesión/i })).not.toBeInTheDocument();

    await userEvent.click(items[0]!);
    expect(await screen.findByRole("heading", { name: "Cuenta" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings");
  });
});

describe("US-A05 scenario 2: the hub's rows follow the role — business first, the person below, the door last", () => {
  it("the owner sees Saldo (with the balance), Configuración, Integraciones and Usuarios, then the passkeys row and Cerrar sesión", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, observing: true })));
    renderApp("/settings");
    await screen.findByRole("heading", { name: "Cuenta" });

    /* The identity card: who, where, as what */
    expect(screen.getAllByText("Leo Licona").length).toBeGreaterThan(0);
    expect(screen.getAllByText("demo@devolada.app").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dueño").length).toBeGreaterThan(0);

    const negocio = screen.getByRole("region", { name: "Negocio" });
    const rows = within(negocio).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(rows).toEqual(["/settings/credit", "/settings/business", "/integrations", "/settings/users"]);
    expect(within(negocio).getByRole("link", { name: /^saldo y recargas/i })).toHaveTextContent("$100.00");
    /* D5: the observation state has a home in the hub */
    expect(within(negocio).getByRole("link", { name: /^integraciones/i })).toHaveTextContent("Modo observación");

    const cuenta = screen.getByRole("region", { name: "Tu cuenta" });
    expect(within(cuenta).getByRole("link", { name: /entrar con huella o rostro/i })).toHaveAttribute("href", "/settings/security");
    expect(screen.getByRole("button", { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it("a viewer's hub holds no Negocio group at all", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, role: "viewer" })));
    renderApp("/settings");
    await screen.findByRole("heading", { name: "Cuenta" });
    expect(screen.queryByRole("region", { name: "Negocio" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /entrar con huella o rostro/i })).toBeInTheDocument();
    expect(screen.getAllByText("Lector").length).toBeGreaterThan(0);
  });
});

describe("US-A05 scenario 4: the avatar wears the credit step, never color alone", () => {
  it("low balance: the item is named 'Cuenta, saldo bajo' and carries the glyph", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, credit: { balanceCents: 2000, step: "low" } })),
      handlers.feed(() => ok(feed)),
    );
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.getAllByRole("link", { name: "Cuenta, saldo bajo" })).toHaveLength(2);
    expect(screen.getAllByTestId("avatar-step").length).toBeGreaterThan(0);
  });

  it("normal balance: 'Cuenta' alone, no glyph", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.feed(() => ok(feed)));
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.getAllByRole("link", { name: "Cuenta" })).toHaveLength(2);
    expect(screen.queryByTestId("avatar-step")).not.toBeInTheDocument();
  });
});

describe("US-A05 scenario 5: the old anchors keep landing on their card", () => {
  it("/settings#saldo opens Saldo y recargas", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.credit(() => ok(credit)),
      handlers.creditEntries(() => ok({ entries: [] })),
      handlers.topUps(() => ok({ topUps: [] })),
    );
    const router = renderApp("/settings#saldo");
    expect(await screen.findByRole("heading", { name: "Saldo y recargas" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/credit");
  });

  it("/settings#spei opens the business page with the hash kept", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings)));
    const router = renderApp("/settings#spei");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/business");
    expect(router.state.location.hash).toBe("spei");
  });

  it("/settings#cargo lands on the SPEI card, where the one fee lives (settings D9)", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings)));
    const router = renderApp("/settings#cargo");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/business");
    expect(router.state.location.hash).toBe("spei");
  });
});

describe("US-A05 scenario 6: each sub-page renders its cards; a phone gets the way back", () => {
  it("/settings/business holds the three business cards and its index; Volver a Cuenta points at the hub", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings)));
    renderApp("/settings/business");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    for (const name of [/política de conciliación/i, /zona horaria y hora/i]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    /* settings D9: the general fee card is gone; the SPEI card holds the fee */
    expect(screen.queryByRole("heading", { name: /^cargo por servicio$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Usuarios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sesión" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a cuenta/i })).toHaveAttribute("href", "/settings");
  });

  it("/settings/users as an admin: Usuarios; /settings/credit as an admin: back to the hub (D3 matrix)", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "admin" })),
      handlers.members(() => ok({ members: [], invitations: [], grantable: ["operator", "viewer"] })),
    );
    const router = renderApp("/settings/users");
    expect(await screen.findByRole("heading", { name: "Usuarios" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /volver a cuenta/i }));
    await screen.findByRole("heading", { name: "Cuenta" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    expect(screen.queryByRole("link", { name: /^saldo y recargas/i })).not.toBeInTheDocument();
  });
});
