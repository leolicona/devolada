import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/legacy/admin/settings.spec.md scenarios 5–7. */

const settings = (over: Record<string, unknown> = {}) =>
  settingsResponse.parse({
    serviceFeeCents: 1500,
    timezone: "America/Mexico_City",
    timeFormat: "12h",
    wisphub: { configured: true, keyTail: "1234" },
    spei: {
      clabe: null,
      bank: null,
      beneficiaryName: null,
      serviceFeeCents: null,
      effectiveServiceFeeCents: 1500,
      bankUnknown: false,
      configured: false,
    },
    reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
    ...over,
  });

describe("US-D13: the beneficiary name is recommended, never required", () => {
  it("scenario 7: SPEI saves with clabe and bank alone, sending null for the name", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      /* The bank is already picked; only the CLABE is typed here */
      handlers.settings(() =>
        ok(
          settings({
            spei: {
              clabe: null,
              bank: "STP",
              beneficiaryName: null,
              serviceFeeCents: null,
              effectiveServiceFeeCents: 1500,
              bankUnknown: false,
              configured: false,
            },
          }),
        ),
      ),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings());
      }),
    );
    renderApp("/settings/direct-payment");

    const clabe = await screen.findByLabelText("CLABE");
    await userEvent.type(clabe, "646180157000000004");

    /* claimed-amount D5: the field says it is optional, and empty is a
       valid configuration — the save is not held hostage to it */
    expect(screen.getByLabelText(/nombre del beneficiario/i)).toHaveValue("");
    const saveButton = screen.getByRole("button", { name: /guardar pago directo/i });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);
    expect(patches).toMatchObject([{ speiBeneficiaryName: null }]);
  });
});

/* settings D9 (BUG-017): one fee, one control — the SPEI card's field. */
describe("US-A04: the service fee has one control, on the SPEI card", () => {
  const configured = () =>
    settings({
      spei: {
        clabe: "646180157000000004",
        bank: "STP",
        beneficiaryName: null,
        serviceFeeCents: null,
        effectiveServiceFeeCents: 1500,
        bankUnknown: false,
        configured: true,
      },
    });

  it("scenario 5: the page offers the fee once, opened on the fee in force, and saves it as the SPEI fee", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(configured())),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(configured());
      }),
    );
    renderApp("/settings/direct-payment");

    const fee = await screen.findByLabelText("Cargo por servicio SPEI");
    /* BUG-017: the general card is gone — one field for one number */
    expect(screen.queryByRole("heading", { name: "Cargo por servicio" })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/cargo por servicio/i)).toHaveLength(1);
    /* never saved yet → the field shows the default in force, not a blank */
    expect(fee).toHaveValue("15.00");

    await userEvent.clear(fee);
    await userEvent.type(fee, "20.00");
    await userEvent.click(screen.getByRole("button", { name: /guardar pago directo/i }));

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ speiServiceFeeCents: 2000 });
    expect(patches[0]).not.toHaveProperty("serviceFeeCents");
  });

  it("D9: an empty fee cannot be saved — there is no general fee to fall back to", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(configured())));
    renderApp("/settings/direct-payment");

    const fee = await screen.findByLabelText("Cargo por servicio SPEI");
    await userEvent.clear(fee);
    expect(screen.getByRole("button", { name: /guardar pago directo/i })).toBeDisabled();
  });
});

describe("US-A04: the configured format reaches every time on screen", () => {
  it("renders feed times in 24h when the ISP chose 24h", async () => {
    const at = Date.UTC(2026, 7, 14, 20, 30); /* 14:30 in Mexico City */
    const charge = {
      id: "ch-1",
      folio: "DV-FMT01",
      channel: "spei" as const,
      status: "confirmed" as const,
      actionOutcome: "done" as const,
      reconciliationClass: "exact" as const,
      receivedCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      askedCents: 41400,
      missingCents: 0,
      surplusCents: 0,
      observedAction: null,
      dispatchedAction: null,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: at,
      actionDoneAt: at,
      actionAttempts: 1,
      actionError: null,
    };
    server.use(
      handlers.session(() => ok({ ...businessActor, timeFormat: "24h" })),
      handlers.feed(() =>
        ok(feedResponse.parse({ payments: [charge], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 1, totalCents: 41400, startedAtMs: Date.UTC(2026, 7, 14, 6) } })),
      ),
    );
    renderApp("/");

    expect(await screen.findByText("14:30")).toBeInTheDocument();
  });
});

/* docs/legacy/direct-payment/partial-payment.spec.md D2/D4 (US-D10): the dial
   for short payments, with its meaning computed on screen — the default
   (100 / $0) explained in one line, as the spec's DoD asks. */
describe("US-R02: the reconciliation policy is the business's", () => {
  it("saves the tolerance and the surplus treatment", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings());
      }),
    );
    renderApp("/settings/direct-payment");

    const tolerance = await screen.findByLabelText("Tolerancia");
    await userEvent.clear(tolerance);
    await userEvent.type(tolerance, "1.00");
    await userEvent.click(screen.getByRole("button", { name: "Guardar política" }));

    expect(patches).toEqual([{ toleranceCents: 100, overTreatment: "flag" }]);
  });

  it("D2: names the effective treatment when the integration overrides it", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() =>
        ok(
          settings({
            reconciliationPolicy: {
              toleranceCents: 0,
              overTreatment: "flag",
              effectiveOverTreatment: "credit",
            },
          }),
        ),
      ),
    );
    renderApp("/settings/direct-payment");

    expect(await screen.findByText(/tratamiento efectivo/)).toBeInTheDocument();
  });
});
/* US-A04, D10: the in-page index retired — three cards need no table of
   contents, and the ids it linked to are still the deep-link contract. */
describe("Configuración has no in-page index", () => {
  it("renders no section nav, and keeps the ids the deep links land on", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
    );
    renderApp("/settings/direct-payment");

    expect(await screen.findByRole("heading", { name: "Pago directo por SPEI" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Secciones de configuración" })).not.toBeInTheDocument();
    for (const label of ["Pago directo", "Política de conciliación", "Zona y hora"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    /* account-hub D4: the deep links still have somewhere to land */
    for (const id of ["spei", "politica"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

/* US-A04 scenario 6 (D11): one page answering three questions became two
   pages, and the path they came from still leads to both. */
describe("US-A04 scenario 6: Configuración splits in two", () => {
  it("each page holds its own cards, and neither holds the other's", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings())));
    renderApp("/settings/direct-payment");

    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /política de conciliación/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /zona horaria y hora/i })).not.toBeInTheDocument();
  });

  it("Preferencias holds the clock and nothing about money", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings())));
    renderApp("/settings/preferences");

    expect(await screen.findByRole("heading", { name: /zona horaria y hora/i })).toBeInTheDocument();
    expect(document.getElementById("zona")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /pago directo por spei/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /política de conciliación/i })).not.toBeInTheDocument();
  });

  it("the old path redirects, and the hash decides which of the two it meant", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings())));
    const router = renderApp("/settings/business#zona");
    expect(await screen.findByRole("heading", { name: /zona horaria y hora/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/preferences");
    expect(router.state.location.hash).toBe("zona");
  });

  it("the old path without a hash lands on Pago directo y conciliación", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(settings())));
    const router = renderApp("/settings/business");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/direct-payment");
  });
});

/* receipt-triage US3 (contracts/settings.md; D9, D26, D29, D32): the
   accounts a business is paid at, and the one its payers see. */
describe("receipt-triage US3: Cuentas para recibir pagos", () => {
  const withAccounts = (spei: Record<string, unknown> = {}) =>
    settings({
      spei: {
        clabe: "646180157000000004",
        bank: "STP",
        beneficiaryName: null,
        serviceFeeCents: null,
        effectiveServiceFeeCents: 1500,
        bankUnknown: false,
        configured: true,
        card: null,
        cardBank: null,
        phone: null,
        phoneBank: null,
        collectKind: "clabe",
        ...spei,
      },
    });
  const pickBank = async (name: string, query: string) => {
    const field = screen.getByRole("combobox", { name });
    await userEvent.type(field, query);
    await userEvent.keyboard("{ArrowDown}{Enter}");
  };

  it("the owner registers a card with its bank and makes it the cuenta de cobro", async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(withAccounts())),
      handlers.patchSettings((body) => {
        patches.push(body as Record<string, unknown>);
        return ok(withAccounts());
      }),
    );
    const { container } = { container: document.body };
    renderApp("/settings/direct-payment");

    expect(await screen.findByRole("heading", { name: "Cuentas para recibir pagos" })).toBeInTheDocument();
    expect(screen.getByText("Debe ser una tarjeta de débito que reciba transferencias.")).toBeInTheDocument();
    expect(screen.getByText("El número que tu banco tiene registrado para recibir transferencias.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "CLABE ••••0004" })).toBeChecked();

    await userEvent.type(screen.getByLabelText("Tarjeta de débito"), "4111111111111111");
    expect(screen.getByText("Elige el banco.")).toBeInTheDocument();
    await pickBank("Banco de tarjeta de débito", "nubank");
    await userEvent.click(screen.getByRole("radio", { name: "Tarjeta de débito ••••1111" }));
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: /guardar pago directo/i }));
    expect(patches[0]).toMatchObject({ speiCard: "4111111111111111", speiCardBank: "NUBANK", speiCollectKind: "card" });
  });

  it.each([
    ["4111", "La tarjeta debe tener 16 dígitos."],
    ["4111111111111112", "Revisa el número de la tarjeta: no es válido."],
  ])("the card %s shows its inline error", async (value, error) => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(withAccounts())));
    renderApp("/settings/direct-payment");
    await userEvent.type(await screen.findByLabelText("Tarjeta de débito"), value);
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar pago directo/i })).toBeDisabled();
  });

  it("a phone short of ten digits says so", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.settings(() => ok(withAccounts())));
    renderApp("/settings/direct-payment");
    await userEvent.type(await screen.findByLabelText("Celular para transferencias"), "55123");
    expect(screen.getByText("El celular debe tener 10 dígitos.")).toBeInTheDocument();
  });

  it("clearing the account where the business is paid, while another exists, asks to choose first", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(withAccounts({ card: "4111111111111111", cardBank: "NUBANK" }))),
    );
    renderApp("/settings/direct-payment");
    await userEvent.clear(await screen.findByLabelText("CLABE"));
    expect(screen.getByText("No puedes borrar la cuenta donde te pagan: elige otra primero.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar pago directo/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Tarjeta de débito ••••1111" }));
    expect(screen.getByRole("button", { name: /guardar pago directo/i })).toBeEnabled();
  });

  it("an admin reads the accounts, with the lock line, and cannot edit them", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "admin" })),
      handlers.settings(() => ok(withAccounts({ card: "4111111111111111", cardBank: "NUBANK" }))),
    );
    renderApp("/settings/direct-payment");
    expect(await screen.findByText("Solo la persona dueña del negocio puede cambiarlas.")).toBeInTheDocument();
    expect(screen.getByText("4111111111111111")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Tarjeta de débito" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "CLABE ••••0004" })).toBeDisabled();
    await expectNoViolations(document.body);
  });
});
