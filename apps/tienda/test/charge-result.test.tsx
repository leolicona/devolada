import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chargeResponse, customerQuoteResponse } from "@devolada/api/charges-schema";
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
