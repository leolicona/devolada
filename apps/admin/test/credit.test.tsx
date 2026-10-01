import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/legacy/platform/prepaid-credit.spec.md UI (US-B04, US-B05) and
   docs/legacy/platform/operator-panel.spec.md scenario 9 (US-L02).

   Also searchable-picker US3: the top-up's sending bank is the second of the
   three screens that name a bank, and it must behave as the first one does. */

const feed = { payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } };
const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: { clabe: "646180157000000004", bank: "STP", beneficiaryName: null, serviceFeeCents: null, effectiveServiceFeeCents: 1500, bankUnknown: false, configured: true },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
});
const credit = (over: Record<string, unknown> = {}) => ({
  balanceCents: 10000,
  feeCents: 500,
  capCents: 5000,
  minTopUpCents: 5000,
  step: "ok",
  topUp: { clabe: "646180157099999999", bank: "STP", beneficiary: "Devolada" },
  ...over,
});
const entries = {
  entries: [
    { id: "e2", kind: "validation_fee", cents: -500, reason: null, createdAt: Date.UTC(2026, 8, 1, 12) },
    { id: "e1", kind: "welcome_bonus", cents: 10000, reason: null, createdAt: Date.UTC(2026, 8, 1, 11) },
  ],
  nextCursor: null,
};

const withCredit = (step: "ok" | "low" | "empty" | "paused", balanceCents: number) =>
  ok({ ...businessActor, credit: { balanceCents, step } });

describe("US-B04: the chip and the banners — label and icon per step, never color alone", () => {
  it.each([
    ["ok", 10000, "Saldo"],
    ["low", 2000, "Saldo bajo"],
    ["empty", 0, "Sin saldo"],
    ["paused", -6000, "Validación en pausa"],
  ] as const)("step %s shows '%s'", async (step, balance, label) => {
    server.use(handlers.session(() => withCredit(step, balance)), handlers.feed(() => ok(feed)));
    renderApp("/");
    const chips = await screen.findAllByRole("link", { name: new RegExp(`^${label}:`) });
    expect(chips.length).toBeGreaterThan(0);
    /* shell header: the normal step is icon + amount; the label shows up
       from "Saldo bajo" on — a label that appears is the non-color signal. */
    if (step === "ok") expect(within(chips[0]).queryByText(label)).not.toBeInTheDocument();
    else expect(within(chips[0]).getByText(label)).toBeInTheDocument();
  });

  it("the pause banner names the way out; a low balance shows no banner", async () => {
    server.use(handlers.session(() => withCredit("paused", -6000)), handlers.feed(() => ok(feed)));
    renderApp("/");
    expect(await screen.findByText(/los comprobantes nuevos de tus clientes quedan guardados/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^recargar$/i })).toBeInTheDocument();
  });

  it("a viewer reads the pause banner without Recargar (account-hub D10)", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, role: "viewer", credit: { balanceCents: -6000, step: "paused" } })), handlers.feed(() => ok(feed)));
    renderApp("/");
    expect(await screen.findByText(/los comprobantes nuevos de tus clientes quedan guardados/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^recargar$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^recargar$/i })).not.toBeInTheDocument();
  });
});

/* account-hub D9/D10 (US-A05 scenarios 10, 11): the phone's word for a
   low balance is a strip the owner closes, remembered per business and
   step; Recargar only for a role that can top up. */
/* The amount is its own element, so the strip is found by its landmark
   and read as a whole */
const findStrip = async () => {
  /* Waits for THIS status, not for the first one to appear. The shell's
     session gate now owns a live region of its own while it loads
     (feedback-vocabulary-rollout D1/D4), so resolving on "any status" and then
     filtering would race it and find an empty one. */
  let strip: HTMLElement | undefined;
  await waitFor(() => {
    strip = screen.queryAllByRole("status").find((el) => el.textContent?.includes("Saldo bajo"));
    if (!strip) throw new Error("no strip");
  });
  return strip!;
};
const stripShown = () => screen.queryAllByRole("status").some((el) => el.textContent?.includes("Saldo bajo"));

describe("US-A05: 'Saldo bajo' is a strip the owner closes, not a toast", () => {
  beforeEach(() => localStorage.clear());

  it("scenario 10: shows the amount and Recargar; closing hides it and a reload keeps it hidden; a new step announces again", async () => {
    let step: "low" | "empty" = "low";
    let balance = 2000;
    server.use(handlers.session(() => withCredit(step, balance)), handlers.feed(() => ok(feed)));
    renderApp("/");

    const strip = await findStrip();
    expect(strip).toHaveTextContent("Saldo bajo: $20.00");
    expect(within(strip).getByRole("link", { name: /^recargar$/i })).toHaveAttribute("href", "/settings/credit");
    /* No banner for a low balance: the strip is the whole signal */
    expect(screen.queryByText(/tu saldo llegó a cero/i)).not.toBeInTheDocument();

    await userEvent.click(within(strip).getByRole("button", { name: /cerrar aviso/i }));
    expect(stripShown()).toBe(false);
    /* The sidebar chip still says it: the strip was the phone's copy */
    expect(screen.getAllByRole("link", { name: /^Saldo bajo:/ }).length).toBeGreaterThan(0);

    /* A reload (fresh app, same browser) keeps the choice */
    cleanup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(stripShown()).toBe(false);

    /* The balance hits zero: the banner, not the strip; then recovers to
       low again: the strip returns — a new crossing is a new notice */
    cleanup();
    step = "empty";
    balance = 0;
    renderApp("/");
    expect(await screen.findByText(/tu saldo llegó a cero/i)).toBeInTheDocument();
    expect(stripShown()).toBe(false);
    cleanup();
    step = "low";
    balance = 1500;
    renderApp("/");
    expect(await findStrip()).toHaveTextContent("Saldo bajo: $15.00");
  }, 15_000); /* four mounts in one story: the default 5s is one mount's budget (TESTING rule 7) */

  it("scenario 11: a viewer reads the strip without Recargar", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, role: "viewer", credit: { balanceCents: 2000, step: "low" } })), handlers.feed(() => ok(feed)));
    renderApp("/");
    const strip = await findStrip();
    expect(strip).toHaveTextContent("Saldo bajo: $20.00");
    expect(within(strip).queryByRole("link", { name: /^recargar$/i })).not.toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: /cerrar aviso/i })).toBeInTheDocument();
  });
});

describe("US-B05: Saldo y recargas — the owner's page", () => {
  it("shows the balance, the fee and the book; Recargar reveals the platform's account and the manual door posts the transfer", async () => {
    const posted: unknown[] = [];
    server.use(
      handlers.session(() => withCredit("ok", 10000)),
      handlers.settings(() => ok(settings)),
      handlers.members(() => ok({ members: [], grantable: ["owner", "admin", "operator", "viewer"] })),
      handlers.credit(() => ok(credit())),
      handlers.creditEntries(() => ok(entries)),
      handlers.topUps(() => ok({ topUps: [] })),
      handlers.submitTopUp((body) => {
        posted.push(body);
        return ok({ id: "t1", status: "credited", claimedCents: 25000, creditedCents: 25000, proofMode: "transfer", trackingKey: "TOPUP0001ABC", validationAttempts: 1, nextValidationAt: null, error: null, createdAt: 1, confirmedAt: 2 }, 201);
      }),
    );
    renderApp("/settings/credit");
    const card = (await screen.findByRole("heading", { name: "Saldo y recargas" })).closest("div")!.parentElement!;
    expect(within(card).getByText("Bono de bienvenida")).toBeInTheDocument();
    expect(within(card).getByText("Validación")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: /^recargar$/i }));
    expect(await screen.findByText("646180157099999999")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copiar clabe/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Clave de rastreo"), "TOPUP0001ABC");
    /* searchable-picker US3 (AC1): the same field as Configuración, driven the
       same way — typing narrows it and the same keys finish it. Clicking a row
       would prove the control is present; typing proves it is the same one. */
    const bank = screen.getByRole("combobox", { name: "Banco desde el que transferiste" });
    await userEvent.type(bank, "bbva");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(bank).toHaveValue("BBVA MEXICO");
    await userEvent.type(screen.getByLabelText("Fecha"), "2026-09-01");
    await userEvent.type(screen.getByLabelText("Monto transferido"), "250.00");
    await userEvent.click(screen.getByRole("button", { name: /validar recarga/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ transfer: { trackingKey: "TOPUP0001ABC", senderBank: "BBVA MEXICO", date: "2026-09-01", amountCents: 25000 } });
  });

  it("below the minimum the form says so and does not submit", async () => {
    server.use(
      handlers.session(() => withCredit("ok", 10000)),
      handlers.settings(() => ok(settings)),
      handlers.members(() => ok({ members: [], grantable: [] })),
      handlers.credit(() => ok(credit())),
      handlers.creditEntries(() => ok(entries)),
      handlers.topUps(() => ok({ topUps: [] })),
    );
    renderApp("/settings/credit");
    await userEvent.click(await screen.findByRole("button", { name: /^recargar$/i }));
    await userEvent.type(await screen.findByLabelText("Monto transferido"), "20.00");
    expect(await screen.findByText(/el mínimo es/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /validar recarga/i })).toBeDisabled();
  });

  it("an admin does not see Saldo y recargas (D3: the owner's area)", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "admin" })),
      handlers.settings(() => ok(settings)),
      handlers.members(() => ok({ members: [], grantable: ["operator", "viewer"] })),
    );
    /* account-hub D5: the sub-page sends the role back to the hub */
    const router = renderApp("/settings/credit");
    await screen.findByRole("heading", { name: "Cuenta" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    expect(screen.queryByRole("heading", { name: "Saldo y recargas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^saldo y recargas/i })).not.toBeInTheDocument();
  });
});

describe("US-L02 scenario 9: the operator panel is the operator's alone", () => {
  const settingsList = {
    settings: [
      { key: "validation_fee_cents", type: "cents", birth: "500", current: "500", history: [] },
      { key: "topup_clabe", type: "clabe", birth: null, current: null, history: [] },
      { key: "default_fee_payer", type: "enum", birth: "isp", current: "isp", history: [] },
    ],
  };

  it("hidden and redirected for a non-operator", async () => {
    server.use(handlers.session(() => withCredit("ok", 10000)), handlers.feed(() => ok(feed)));
    const router = renderApp("/operador");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.queryByRole("link", { name: "Operador" })).not.toBeInTheDocument();
  });

  it("the operator saves a rule as cents and adjusts a business with a reason", async () => {
    const saved: [string, unknown][] = [];
    const adjusted: [string, unknown][] = [];
    server.use(
      handlers.session(() => ok({ ...businessActor, platformOperator: true })),
      handlers.platformSettings(() => ok(settingsList)),
      handlers.setPlatformSetting((key, body) => {
        saved.push([key, body]);
        return ok({ key, value: "300", createdAt: 1 }, 201);
      }),
      handlers.platformBusinesses(() =>
        ok({ businesses: [{ id: "b1", name: "WifiPlus", email: "owner@wifiplus.mx", status: "active", balanceCents: 1500, step: "low", feeCents: 500, feeOverrideCents: null, createdAt: 1, storeChannel: { on: false, since: null }, capabilities: [], storeHeldCents: 0 }] }),
      ),
      handlers.platformBusiness(() =>
        ok({ id: "b1", name: "WifiPlus", email: "owner@wifiplus.mx", status: "active", balanceCents: 1500, step: "low", feeCents: 500, feeOverrideCents: null, createdAt: 1, storeChannel: { on: false, since: null }, capabilities: [], storeHeldCents: 0, entries: [], nextCursor: null }),
      ),
      handlers.adjustment((id, body) => {
        adjusted.push([id, body]);
        return ok({ id: "adj", cents: 2000, reason: "x", createdAt: 1 }, 201);
      }),
    );
    renderApp("/operador");
    expect(await screen.findByRole("link", { name: "Operador" })).toBeInTheDocument();

    const fee = await screen.findByLabelText("Tarifa por validación");
    await userEvent.clear(fee);
    await userEvent.type(fee, "3.00");
    await userEvent.click(screen.getByRole("button", { name: "Guardar Tarifa por validación" }));
    await waitFor(() => expect(saved).toEqual([["validation_fee_cents", { value: 300 }]]));

    await userEvent.click(screen.getByRole("tab", { name: "Negocios" }));
    await userEvent.click(await screen.findByRole("button", { name: /WifiPlus/ }));
    await userEvent.type(await screen.findByLabelText("Monto del ajuste"), "20.00");
    await userEvent.type(screen.getByLabelText(/motivo/i), "Cortesía piloto: doble cobro");
    await userEvent.click(screen.getByRole("button", { name: /registrar ajuste/i }));
    await waitFor(() => expect(adjusted).toEqual([["b1", { cents: 2000, reason: "Cortesía piloto: doble cobro" }]]));
  });
});
