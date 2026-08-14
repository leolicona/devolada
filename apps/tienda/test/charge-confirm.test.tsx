import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { customerQuoteResponse } from "@devolada/api/charges-schema";
import { fail, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/charges/charge-confirm.spec.md scenarios 5–7.
   Mock payloads are parsed with the real API schema, so they cannot lie. */

function quote(overrides: { billingStatus?: "paid" | "due"; blocked?: boolean } = {}) {
  return customerQuoteResponse.parse({
    customer: {
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely",
      zone: "Zona dia 15",
      serviceStatus: "suspended",
      billingStatus: overrides.billingStatus ?? "due",
      monthlyFeeCents: 49900,
    },
    quote: { monthlyFeeCents: 49900, serviceFeeCents: 1500, totalCents: 51400 },
    cap: { balanceCents: 0, capCents: 500000, blocked: overrides.blocked ?? false },
  });
}

function mount(data: ReturnType<typeof quote>) {
  server.use(
    handlers.session(() => ok(storeActor)),
    handlers.customerQuote(() => ok(data)),
  );
  renderApp("/charge/greyes%40wifiplus");
}

describe("US-C02: the screen shows identity, breakdown and the charge button", () => {
  it("shows name, breakdown lines and 'Cobrar' with the total", async () => {
    mount(quote());

    expect(await screen.findByRole("heading", { name: "Janely" })).toBeInTheDocument();
    expect(screen.getByText("Mensualidad")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
    expect(screen.getByText("Servicio suspendido")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /cobrar \$514\.00/i });
    expect(button).toBeEnabled();
  });
});

describe("US-C02: 'paid' means no charge", () => {
  it("shows 'Sin adeudo' and no charge button", async () => {
    mount(quote({ billingStatus: "paid" }));

    expect(await screen.findByText(/sin adeudo/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cobrar/i })).not.toBeInTheDocument();
  });
});

describe("US-K04: the balance cap blocks the button", () => {
  it("shows a disabled button and the plain explanation", async () => {
    mount(quote({ blocked: true }));

    expect(await screen.findByText(/registra una entrega/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cobrar/i })).toBeDisabled();
  });
});
