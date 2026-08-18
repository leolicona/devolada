import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { customerQuoteResponse } from "@devolada/api/charges-schema";
import { fail, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/charges/charge-confirm.spec.md scenarios 5–7.
   Mock payloads are parsed with the real API schema, so they cannot lie. */

function quote(
  overrides: { billingStatus?: "paid" | "due"; blocked?: boolean; hasPhone?: boolean } = {},
) {
  return customerQuoteResponse.parse({
    customer: {
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely",
      zone: "Zona dia 15",
      serviceStatus: "suspended",
      billingStatus: overrides.billingStatus ?? "due",
      monthlyFeeCents: 49900,
      hasPhone: overrides.hasPhone ?? true,
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

/* A customer nobody has a number for, up to the result screen. The
   returned object collects what the charge request actually carried. */
function mountWithoutPhone() {
  const sent: { body: Record<string, unknown> | null } = { body: null };
  const created = {
    id: "ch-1",
    folio: "DV-A1B2C3",
    reconnectionStatus: "queued",
    totalCents: 51400,
    customerName: "Janely",
  };
  server.use(
    handlers.session(() => ok(storeActor)),
    handlers.customerQuote(() => ok(quote({ hasPhone: false }))),
    http.post("/charges", async ({ request }) => {
      sent.body = (await request.json()) as Record<string, unknown>;
      return ok(created, 201);
    }),
    handlers.chargeStatus(() => ok(created)),
    handlers.receipt(() =>
      ok({
        folio: "DV-A1B2C3",
        customerName: "Janely",
        totalCents: 51400,
        monthlyFeeCents: 49900,
        serviceFeeCents: 1500,
        reconnectionStatus: "queued",
        text: "Comprobante",
        waLink: "https://wa.me/525551234567?text=Comprobante",
        phone: "525551234567",
      }),
    ),
  );
  renderApp("/charge/greyes%40wifiplus");
  return sent;
}

/* docs/charges/customer-phone.spec.md scenarios 1, 3 and 6 (US-C07) */
describe("US-C07: the phone is asked for only when nobody has one", () => {
  it("with a known phone the screen asks nothing", async () => {
    mount(quote({ hasPhone: true }));

    await screen.findByRole("heading", { name: "Janely" });
    expect(screen.queryByLabelText(/teléfono/i)).not.toBeInTheDocument();
  });

  it("without one it offers the optional field and sends what was typed", async () => {
    const sent = mountWithoutPhone();

    await userEvent.type(
      await screen.findByLabelText(/teléfono para el comprobante \(opcional\)/i),
      "5551234567",
    );
    await userEvent.click(screen.getByRole("button", { name: /cobrar/i }));

    await screen.findByText("Folio DV-A1B2C3");
    expect(sent.body).toEqual({ usuario: "greyes@wifiplus", customerPhone: "5551234567" });
  });

  it("an unfinished number never blocks the charge: it simply does not travel", async () => {
    const sent = mountWithoutPhone();

    await userEvent.type(await screen.findByLabelText(/teléfono/i), "555123");
    const button = screen.getByRole("button", { name: /cobrar/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    await screen.findByText("Folio DV-A1B2C3");
    expect(sent.body).toEqual({ usuario: "greyes@wifiplus" });
  });
});
