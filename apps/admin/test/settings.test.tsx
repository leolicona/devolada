import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/settings.spec.md scenarios 5–7. */

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
    renderApp("/settings");

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

describe("US-A04: the service fee is saved", () => {
  it("saves the fee that the SPEI channel falls back to", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings({ serviceFeeCents: 2000 }));
      }),
    );
    renderApp("/settings");

    const fee = await screen.findByLabelText("Cargo por servicio");
    await userEvent.clear(fee);
    await userEvent.type(fee, "20.00");

    await userEvent.click(screen.getByRole("button", { name: /guardar cargo por servicio/i }));
    expect(patches).toEqual([{ serviceFeeCents: 2000 }]);
  });
});

describe("US-A04: the key is tested before it is saved", () => {
  it("reports the test result and does not save on its own", async () => {
    const patches: unknown[] = [];
    let tested: unknown = null;
    server.use(
      handlers.session(() => ok({ ...businessActor, wisphubConfigured: false })),
      handlers.settings(() => ok(settings({ wisphub: { configured: false, keyTail: null } }))),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings());
      }),
      handlers.testWisphub((body) => {
        tested = body;
        return ok({ ok: false, code: "WISPHUB_AUTH_FAILED", sampleCustomerCount: null });
      }),
    );
    renderApp("/settings");

    /* D8: the shell nags while there is no key */
    expect(await screen.findByText(/falta tu llave de wisphub/i)).toBeInTheDocument();
    expect(await screen.findByText(/sin configurar/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/nueva llave/i), "candidate-key-1");
    await userEvent.click(screen.getByRole("button", { name: /probar conexión/i }));

    expect(await screen.findByText(/rechazó esta llave/i)).toBeInTheDocument();
    expect(tested).toEqual({ apiKey: "candidate-key-1" });
    /* D2: testing is not saving */
    expect(patches).toEqual([]);
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

/* docs/direct-payment/partial-payment.spec.md D2/D4 (US-D10): the dial
   for short payments, with its meaning computed on screen — the default
   (100 / $0) explained in one line, as the spec's DoD asks. */
describe("US-D10: the reconnection dial is set from Configuración", () => {
  it("explains the current values in one sentence and saves both numbers", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(
          settings({
            reconnection: {
              thresholdPercent: 70,
              floorCents: 20000,
              provisionalReleaseEnabled: false,
            },
          }),
        );
      }),
    );
    renderApp("/settings");

    /* the default, explained without arithmetic homework */
    expect(
      await screen.findByText(/el servicio regresa cuando el pago cubre todo el adeudo/i),
    ).toBeInTheDocument();

    const percent = screen.getByLabelText("Porcentaje mínimo del adeudo");
    await userEvent.clear(percent);
    await userEvent.type(percent, "70");
    const floor = screen.getByLabelText("Mínimo en pesos");
    await userEvent.clear(floor);
    await userEvent.type(floor, "200.00");

    /* the sentence follows the fields, live */
    expect(
      screen.getByText(/cubre al menos el 70% del adeudo y no es menor a \$200\.00/i),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /guardar reconexión/i }));
    expect(patches).toEqual([
      {
        reconnectionThresholdPercent: 70,
        reconnectionFloorCents: 20000,
        provisionalReleaseEnabled: false,
      },
    ]);
  });

  it("US-D15 D10: the protection switch rides the same save, off by default", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(
          settings({
            reconnection: {
              thresholdPercent: 100,
              floorCents: 0,
              provisionalReleaseEnabled: true,
            },
          }),
        );
      }),
    );
    renderApp("/settings");

    const toggle = await screen.findByRole("switch", {
      name: /proteger el servicio mientras banxico confirma/i,
    });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: /guardar reconexión/i }));

    expect(patches).toEqual([
      {
        reconnectionThresholdPercent: 100,
        reconnectionFloorCents: 0,
        provisionalReleaseEnabled: true,
      },
    ]);
  });

  it("blocks a percentage above 100 before it reaches the API", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
    );
    renderApp("/settings");

    const percent = await screen.findByLabelText("Porcentaje mínimo del adeudo");
    await userEvent.clear(percent);
    await userEvent.type(percent, "101");

    expect(screen.getByText(/entre 0 y 100/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar reconexión/i })).toBeDisabled();
  });
});
/* docs/reconciliation/payments-and-classes.spec.md D1/D2 (US-R02). */
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
    renderApp("/settings");

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
    renderApp("/settings");

    expect(await screen.findByText(/tratamiento efectivo/)).toBeInTheDocument();
  });
});
/* design-review 2026-09-01 (could improve): the in-page section index. */
describe("Configuración carries an in-page index", () => {
  it("links every section the role can use, as anchors", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings())),
    );
    renderApp("/settings");

    const nav = await screen.findByRole("navigation", { name: "Secciones de configuración" });
    const { getByRole } = within(nav);
    for (const label of ["WispHub", "Pago directo", "Política de conciliación", "Saldo y recargas", "Usuarios"]) {
      expect(getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(getByRole("link", { name: "Política de conciliación" })).toHaveAttribute("href", "#politica");
  });
});
