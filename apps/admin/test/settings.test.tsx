import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/charges-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/settings.spec.md scenarios 5–7. */

const settings = (over: Record<string, unknown> = {}) =>
  settingsResponse.parse({
    serviceFeeCents: 1500,
    storeCommissionCents: 900,
    platformShareCents: 600,
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
    reconnection: { thresholdPercent: 100, floorCents: 0 },
    ...over,
  });

describe("US-A04: the split is saved with its share visible", () => {
  it("shows the platform share while typing and saves the two numbers", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings())),
      handlers.settlement(() => ok({ months: [] })),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings({ serviceFeeCents: 2000, storeCommissionCents: 1200, platformShareCents: 800 }));
      }),
    );
    renderApp("/settings");

    expect(await screen.findByText(/quedan/i)).toHaveTextContent("$6.00");

    const fee = screen.getByLabelText("Cargo por servicio");
    await userEvent.clear(fee);
    await userEvent.type(fee, "20.00");
    /* D4: derived live from the two fields, before any save */
    expect(screen.getByText(/quedan/i)).toHaveTextContent("$11.00");

    const commission = screen.getByLabelText("Comisión de la tienda");
    await userEvent.clear(commission);
    await userEvent.type(commission, "12.00");
    expect(screen.getByText(/quedan/i)).toHaveTextContent("$8.00");

    await userEvent.click(screen.getByRole("button", { name: /guardar cobro y comisiones/i }));
    expect(patches).toEqual([{ serviceFeeCents: 2000, storeCommissionCents: 1200 }]);
  });

  it("blocks a commission above the fee before it reaches the API", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings())),
      handlers.settlement(() => ok({ months: [] })),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings());
      }),
    );
    renderApp("/settings");

    const commission = await screen.findByLabelText("Comisión de la tienda");
    await userEvent.clear(commission);
    await userEvent.type(commission, "30.00");

    expect(screen.getByText(/no puede ser mayor al cargo por servicio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar cobro y comisiones/i })).toBeDisabled();
    expect(patches).toEqual([]);
  });
});

describe("US-A04: the key is tested before it is saved", () => {
  it("reports the test result and does not save on its own", async () => {
    const patches: unknown[] = [];
    let tested: unknown = null;
    server.use(
      handlers.session(() => ok({ ...ispActor, wisphubConfigured: false })),
      handlers.settings(() => ok(settings({ wisphub: { configured: false, keyTail: null } }))),
      handlers.settlement(() => ok({ months: [] })),
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
      channel: "store" as const,
      reconnectionStatus: "reconnected" as const,
      totalCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: at,
      reconnectedAt: at,
      attempts: 1,
      lastError: null,
    };
    server.use(
      handlers.session(() => ok({ ...ispActor, timeFormat: "24h" })),
      handlers.feed(() =>
        ok(feedResponse.parse({ charges: [charge], nextCursor: null, today: { count: 1, totalCents: 41400, startedAtMs: Date.UTC(2026, 7, 14, 6) } })),
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
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings())),
      handlers.settlement(() => ok({ months: [] })),
      handlers.patchSettings((body) => {
        patches.push(body);
        return ok(settings({ reconnection: { thresholdPercent: 70, floorCents: 20000 } }));
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
      { reconnectionThresholdPercent: 70, reconnectionFloorCents: 20000 },
    ]);
  });

  it("blocks a percentage above 100 before it reaches the API", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings())),
      handlers.settlement(() => ok({ months: [] })),
    );
    renderApp("/settings");

    const percent = await screen.findByLabelText("Porcentaje mínimo del adeudo");
    await userEvent.clear(percent);
    await userEvent.type(percent, "101");

    expect(screen.getByText(/entre 0 y 100/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guardar reconexión/i })).toBeDisabled();
  });
});
