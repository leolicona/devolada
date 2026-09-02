import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { feedResponse } from "@devolada/api/payments-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/polish/accessibility.spec.md — the admin, screen by screen. */

const feed = feedResponse.parse({
  payments: [
    {
      id: "ch-1",
      folio: "DV-FEED01",
      channel: "spei",
      status: "confirmed",
      actionOutcome: "failed",
      reconciliationClass: "exact",
      receivedCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      askedCents: 41400,
      missingCents: 0,
      surplusCents: 0,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: Date.UTC(2026, 7, 14, 20, 30),
      actionDoneAt: null,
      actionAttempts: 3,
      actionError: "WISPHUB_UNAVAILABLE",
    },
  ],
  nextCursor: null,
  effectiveOverTreatment: "flag",
  today: { count: 1, totalCents: 41400, startedAtMs: Date.UTC(2026, 7, 14, 6) },
});

const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: false, keyTail: null },
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
});

describe("US-P04: the harness reports what it should", () => {
  it("fails on a control with no accessible name", async () => {
    render(
      <div>
        <button type="button" />
        <input type="text" />
      </div>,
    );
    await expect(expectNoViolations(document.body)).rejects.toThrow(/axe found/);
  });
});

describe("US-P04: the admin passes axe on every section", () => {
  it("Pagos, with an expandable failed payment", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.feed(() => ok(feed)));
    renderApp("/");
    await screen.findByText("Janely");
    await expectNoViolations(document.body);
  });

  it("Configuración, including the missing-key banner", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, wisphubConfigured: false })),
      handlers.settings(() => ok(settings)),
    );
    renderApp("/settings");
    await screen.findByLabelText(/nueva llave/i);
    await expectNoViolations(document.body);
  });
});
