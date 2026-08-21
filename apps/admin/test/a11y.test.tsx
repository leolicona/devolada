import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { feedResponse } from "@devolada/api/charges-schema";
import { adminCashDrop, cashDropsResponse } from "@devolada/api/cash-drops-schema";
import { settingsResponse } from "@devolada/api/settings-schema";
import { storeItem, storesResponse } from "@devolada/api/stores-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/polish/accessibility.spec.md — the admin, screen by screen. */

const feed = feedResponse.parse({
  charges: [
    {
      id: "ch-1",
      folio: "DV-FEED01",
      channel: "store",
      reconnectionStatus: "failed",
      totalCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: Date.UTC(2026, 7, 14, 20, 30),
      reconnectedAt: null,
      attempts: 3,
      lastError: "WISPHUB_UNAVAILABLE",
    },
  ],
  nextCursor: null,
  today: { count: 1, totalCents: 41400, startedAtMs: Date.UTC(2026, 7, 14, 6) },
});

const stores = storesResponse.parse({
  stores: [
    storeItem.parse({
      id: "st-1",
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: "5512345678",
      zone: "Centro",
      status: "active",
      invitationStatus: "accepted",
      commissionCents: null,
      balanceCents: 89100,
      cap: { capCents: 100000, approaching: true, blocked: false },
    }),
  ],
});

const drops = cashDropsResponse.parse({
  drops: [
    adminCashDrop.parse({
      id: "cd-1",
      storeId: "st-1",
      storeName: "Abarrotes La Esquina",
      storeZone: "Centro",
      cents: 50600,
      status: "pending",
      note: null,
      createdAt: Date.UTC(2026, 7, 14, 18, 0),
      confirmedAt: null,
      storeBalanceCents: 50600,
    }),
  ],
  nextCursor: null,
});

const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  storeCommissionCents: 900,
  platformShareCents: 600,
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
  it("Cobros, with an expandable failed charge", async () => {
    server.use(handlers.session(() => ok(ispActor)), handlers.feed(() => ok(feed)));
    renderApp("/");
    await screen.findByText("Janely");
    await expectNoViolations(document.body);
  });

  it("Tiendas", async () => {
    server.use(handlers.session(() => ok(ispActor)), handlers.stores(() => ok(stores)));
    renderApp("/stores");
    await screen.findByText("Abarrotes La Esquina");
    await expectNoViolations(document.body);
  });

  it("Entregas, with a pending card", async () => {
    server.use(handlers.session(() => ok(ispActor)), handlers.cashDrops(() => ok(drops)));
    renderApp("/cash-drops");
    await screen.findByRole("button", { name: /confirmar entrega/i });
    await expectNoViolations(document.body);
  });

  it("Configuración, including the missing-key banner", async () => {
    server.use(
      handlers.session(() => ok({ ...ispActor, wisphubConfigured: false })),
      handlers.settings(() => ok(settings)),
      handlers.settlement(() => ok({ months: [] })),
    );
    renderApp("/settings");
    await screen.findByLabelText(/nueva llave/i);
    await expectNoViolations(document.body);
  });
});
