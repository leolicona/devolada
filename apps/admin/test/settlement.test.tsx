import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { settingsResponse } from "@devolada/api/settings-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/platform/settlement.spec.md scenarios 4–5. */

const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  storeCommissionCents: 900,
  platformShareCents: 600,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
});

describe("US-L01: the settlement statement lives in Configuración", () => {
  it("renders months with amount, count, reference and the running label", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings)),
      handlers.settlement(() =>
        ok({
          months: [
            {
              period: "2026-08",
              chargeCount: 23,
              shareCents: 13800,
              reference: "DV-202608-4f2a",
              current: true,
            },
            {
              period: "2026-07",
              chargeCount: 40,
              shareCents: 24000,
              reference: "DV-202607-4f2a",
              current: false,
            },
          ],
        }),
      ),
    );
    renderApp("/settings");

    expect(await screen.findByText("Agosto de 2026")).toBeInTheDocument();
    expect(screen.getByText(/En curso/)).toBeInTheDocument();
    expect(screen.getByText("$138.00")).toBeInTheDocument();
    expect(screen.getByText(/23 cobros/)).toBeInTheDocument();
    expect(screen.getByText("DV-202608-4f2a")).toBeInTheDocument();
    expect(screen.getByText("Julio de 2026")).toBeInTheDocument();
    expect(screen.getByText("$240.00")).toBeInTheDocument();
  });

  it("shows the empty state before the first charge", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.settings(() => ok(settings)),
      handlers.settlement(() => ok({ months: [] })),
    );
    renderApp("/settings");

    expect(
      await screen.findByText(/Aquí aparecerá lo acumulado para la plataforma/),
    ).toBeInTheDocument();
  });
});
