import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { cashboxResponse } from "@devolada/api/cashbox-schema";
import { chargeResponse, customerQuoteResponse, receiptResponse } from "@devolada/api/charges-schema";
import { ledgerResponse } from "@devolada/api/ledger-schema";
import { handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/polish/accessibility.spec.md — the store PWA, screen by screen. */

const cashbox = cashboxResponse.parse({
  storeName: "Abarrotes La Esquina",
  balanceCents: 91000,
  commissionEarnedCents: 1800,
  commissionSince: null,
  cap: { capCents: 500000, approaching: false, blocked: false },
  lastCashDrop: { id: "d1", cents: 40000, status: "disputed", note: "Faltaron $200", createdAt: Date.now() },
});

const quote = customerQuoteResponse.parse({
  customer: {
    wisphubId: 6,
    usuario: "greyes@wifiplus",
    name: "Janely",
    zone: "Zona dia 15",
    serviceStatus: "suspended",
    billingStatus: "due",
    monthlyFeeCents: 49900,
  },
  quote: { monthlyFeeCents: 49900, serviceFeeCents: 1500, totalCents: 51400 },
  cap: { balanceCents: 0, capCents: 500000, blocked: false },
});

const charge = chargeResponse.parse({
  id: "ch-1",
  folio: "DV-A1B2C3",
  reconnectionStatus: "queued",
  totalCents: 51400,
  customerName: "Janely",
});

const receipt = receiptResponse.parse({
  folio: "DV-A1B2C3",
  customerName: "Janely",
  totalCents: 51400,
  monthlyFeeCents: 49900,
  serviceFeeCents: 1500,
  reconnectionStatus: "queued",
  text: "Comprobante de pago Devolada",
  waLink: "https://wa.me/?text=Comprobante",
  phone: null,
});

const ledger = ledgerResponse.parse({
  entries: [
    {
      id: "e1",
      type: "charge",
      cents: 41400,
      createdAt: Date.now(),
      reference: { folio: "DV-A1B2C3", customerName: "Janely" },
    },
  ],
  nextCursor: null,
});

/* A green suite is only worth something if the check can go red. This
   one guards the harness itself: happy-dom or axe could change under us
   and start reporting nothing at all. */
describe("US-P04: the harness reports what it should", () => {
  it("fails on a control with no accessible name", async () => {
    render(
      <div>
        <button type="button" />
        <img src="x.png" />
        <input type="text" />
      </div>,
    );
    await expect(expectNoViolations(document.body)).rejects.toThrow(/axe found/);
  });
});

describe("US-P04: the store PWA passes axe on every screen", () => {
  it("Caja", async () => {
    server.use(handlers.session(() => ok(storeActor)), handlers.cashbox(() => ok(cashbox)));
    renderApp("/cashbox");
    await screen.findByText("Abarrotes La Esquina");
    await expectNoViolations(document.body);
  });

  it("Movimientos", async () => {
    server.use(handlers.session(() => ok(storeActor)), handlers.ledger(() => ok(ledger)));
    renderApp("/ledger");
    await screen.findByText(/Cobro · Janely/);
    await expectNoViolations(document.body);
  });

  it("Cobrar — confirm screen", async () => {
    server.use(handlers.session(() => ok(storeActor)), handlers.customerQuote(() => ok(quote)));
    renderApp("/charge/greyes%40wifiplus");
    await screen.findByText("Janely");
    await expectNoViolations(document.body);
  });

  it("Resultado del cobro, with the receipt actions", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.chargeStatus(() => ok(charge)),
      handlers.receipt(() => ok(receipt)),
    );
    renderApp("/charges/ch-1");
    await screen.findByRole("link", { name: /enviar comprobante/i });
    await expectNoViolations(document.body);
  });

  it("Registrar entrega", async () => {
    server.use(handlers.session(() => ok(storeActor)), handlers.cashbox(() => ok(cashbox)));
    renderApp("/cashbox/drop");
    await screen.findByLabelText("Monto a entregar");
    await expectNoViolations(document.body);
  });
});
