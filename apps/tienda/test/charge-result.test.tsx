import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chargeResponse, customerQuoteResponse, receiptResponse } from "@devolada/api/charges-schema";
import { fail as failResponse, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/charges/charge-record.spec.md scenarios 8–9. */

const quote = customerQuoteResponse.parse({
  customer: {
    wisphubId: 6,
    usuario: "greyes@wifiplus",
    name: "Janely",
    zone: "Zona dia 15",
    serviceStatus: "suspended",
    billingStatus: "due",
    monthlyFeeCents: 49900,
    hasPhone: true,
  },
  quote: { monthlyFeeCents: 49900, serviceFeeCents: 1500, totalCents: 51400 },
  cap: { balanceCents: 0, capCents: 500000, blocked: false },
});

const charge = (status: "queued" | "reconnected") =>
  chargeResponse.parse({
    id: "ch-1",
    folio: "DV-A1B2C3",
    reconnectionStatus: status,
    totalCents: 51400,
    customerName: "Janely",
  });

describe("US-C03: pressing Cobrar records and lands on the result", () => {
  it("posts the charge and shows folio and status", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.customerQuote(() => ok(quote)),
      handlers.recordCharge(() => ok(charge("queued"), 201)),
      handlers.chargeStatus(() => ok(charge("queued"))),
    );
    const router = renderApp("/charge/greyes%40wifiplus");

    await userEvent.click(await screen.findByRole("button", { name: /cobrar/i }));

    expect(await screen.findByText("Folio DV-A1B2C3")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/charges/ch-1");
  });
});

describe("US-C03: the result shows the live status", () => {
  it("queued shows the amber explanation", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.chargeStatus(() => ok(charge("queued"))),
    );
    renderApp("/charges/ch-1");

    expect(await screen.findByText("Reconexión en cola")).toBeInTheDocument();
    expect(screen.getByText(/se aplicará sola/i)).toBeInTheDocument();
  });

  it("reconnected shows the green badge and no waiting note", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.chargeStatus(() => ok(charge("reconnected"))),
    );
    renderApp("/charges/ch-1");

    expect(await screen.findByText("Reconectado")).toBeInTheDocument();
    expect(screen.queryByText(/se aplicará sola/i)).not.toBeInTheDocument();
  });
});

describe("US-C04: a 409 reloads the quote so the screen tells the truth", () => {
  it("BALANCE_CAP_EXCEEDED refetches and shows the blocked state", async () => {
    let blocked = false;
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.customerQuote(() =>
        ok({ ...quote, cap: { ...quote.cap, blocked } }),
      ),
      handlers.recordCharge(() => {
        blocked = true;
        return failResponse("BALANCE_CAP_EXCEEDED", 409);
      }),
    );
    renderApp("/charge/greyes%40wifiplus");

    await userEvent.click(await screen.findByRole("button", { name: /cobrar/i }));

    expect(await screen.findByText(/registra una entrega/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cobrar/i })).toBeDisabled();
  });
});

/* docs/charges/receipt.spec.md scenario 5. */
describe("US-C05: the store sends the comprobante from its own WhatsApp", () => {
  const receipt = (over: Record<string, unknown> = {}) =>
    receiptResponse.parse({
      folio: "DV-A1B2C3",
      customerName: "Janely",
      totalCents: 51400,
      monthlyFeeCents: 49900,
      serviceFeeCents: 1500,
      reconnectionStatus: "reconnected",
      text: "Comprobante de pago Devolada\n\nFolio: DV-A1B2C3",
      waLink: "https://wa.me/525512345678?text=Comprobante",
      phone: "525512345678",
      ...over,
    });

  it("offers to send and to copy, next to the folio", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.chargeStatus(() => ok(charge("reconnected"))),
      handlers.receipt(() => ok(receipt())),
    );
    renderApp("/charges/ch-1");

    const send = await screen.findByRole("link", { name: /enviar comprobante/i });
    expect(send).toHaveAttribute("href", "https://wa.me/525512345678?text=Comprobante");
    expect(screen.getByRole("button", { name: /copiar comprobante/i })).toBeInTheDocument();
    /* The folio stays readable even if nothing is ever sent */
    expect(screen.getByText(/DV-A1B2C3/)).toBeInTheDocument();
  });

  it("still offers WhatsApp when the customer has no phone (D3)", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.chargeStatus(() => ok(charge("queued"))),
      handlers.receipt(() => ok(receipt({ phone: null, waLink: "https://wa.me/?text=Comprobante" }))),
    );
    renderApp("/charges/ch-1");

    /* No apology, no disabled button: WhatsApp opens its contact picker */
    const send = await screen.findByRole("link", { name: /enviar comprobante/i });
    expect(send).toHaveAttribute("href", "https://wa.me/?text=Comprobante");
    expect(screen.queryByText(/sin teléfono/i)).not.toBeInTheDocument();
  });
});
