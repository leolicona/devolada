import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { feedResponse } from "@devolada/api/payments-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { integrationsResponse } from "@devolada/api/integrations-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/legacy/polish/accessibility.spec.md — the admin, screen by screen. */

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
      observedAction: null,
      dispatchedAction: null,
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

/* Parsed against the contract, not hand-written beside it: this fixture
   had drifted from `integrationsResponse` and the screen rendered
   nothing at all, which a11y reported as a 5s timeout rather than as
   the missing field it was (provider-address-per-isp, 2026-09-18). */
const integrationsFixture = integrationsResponse.parse({
  wisphub: {
    provider: "wisphub",
    configured: true,
    keyTail: "1234",
    installation: "wisphub_io",
    effectiveInstallation: { key: "wisphub_io", label: "wisphub.io", kind: "real", assumed: false },
    actionsEnabled: false,
    mapping: { exact: "register_and_reconnect", short: "register_and_reconnect", over: "register_and_reconnect" },
    thresholdPercent: 100,
    floorCents: 0,
    provisionalReleaseEnabled: false,
  },
  api: { activeCredentials: 0 },
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

  it("Pagos on a low balance: the strip (account-hub D9)", async () => {
    server.use(handlers.session(() => ok({ ...businessActor, credit: { balanceCents: 2000, step: "low" } })), handlers.feed(() => ok(feed)));
    renderApp("/");
    await screen.findByRole("button", { name: /cerrar aviso/i });
    await expectNoViolations(document.body);
  });

  it("Cuenta: the hub (account-hub scenario 8)", async () => {
    server.use(handlers.session(() => ok(businessActor)));
    renderApp("/settings");
    await screen.findByRole("heading", { name: "Cuenta" });
    await expectNoViolations(document.body);
  });

  it("Cuenta: the security sub-page", async () => {
    server.use(handlers.session(() => ok(businessActor)));
    renderApp("/settings/security");
    await screen.findByRole("link", { name: /volver a cuenta/i });
    await expectNoViolations(document.body);
  });

  it("Pago directo y conciliación", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
    );
    renderApp("/settings/direct-payment");
    await screen.findByLabelText("CLABE");
    await expectNoViolations(document.body);
  });

  it("Preferencias", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
    );
    renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: /zona horaria y hora/i });
    await expectNoViolations(document.body);
  });

  it("Integraciones: the catalog and the WispHub detail", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(integrationsFixture)),
    );
    renderApp("/integrations");
    await screen.findByText("API de cobros");
    await expectNoViolations(document.body);
  });

  it("WispHub detail, mapping and switches", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(integrationsFixture)),
    );
    renderApp("/integrations/wisphub");
    await screen.findByLabelText("Ejecutar acciones automáticamente");
    await expectNoViolations(document.body);
  });
});
