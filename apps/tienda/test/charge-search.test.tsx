import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customerSearchResponse } from "@devolada/api/charges-schema";
import { fail, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/charges/customer-search.spec.md scenarios 7–9.
   The mock payload is parsed with the real API schema, so it cannot lie. */

const results = customerSearchResponse.parse({
  customers: [
    {
      wisphubId: 6,
      usuario: "greyes@wifiplus",
      name: "Janely",
      zone: "Zona dia 15",
      serviceStatus: "suspended",
      billingStatus: "due",
      monthlyFeeCents: 49900,
    },
  ],
});

function withSession() {
  server.use(handlers.session(() => ok(storeActor)));
}

describe("US-C01: typing shows result cards with minimum identity", () => {
  it("shows name, zone, status badge and monthly fee", async () => {
    withSession();
    server.use(handlers.customerSearch(() => ok(results)));
    renderApp("/");

    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "Janely");

    expect(await screen.findByText("Janely")).toBeInTheDocument();
    expect(screen.getByText("Zona dia 15")).toBeInTheDocument();
    expect(screen.getByText("Servicio suspendido")).toBeInTheDocument();
    expect(screen.getByText("$499.00")).toBeInTheDocument();
  });

  /* Regression: the card used to link with the numeric wisphubId, which the
     quote endpoint rejects. Mounting the confirm route directly hid it —
     tests must travel from the origin screen (TESTING.md rule 7). */
  it("tapping a result navigates using the usuario, not the numeric id", async () => {
    withSession();
    server.use(handlers.customerSearch(() => ok(results)));
    const router = renderApp("/");

    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "Janely");
    await userEvent.click(await screen.findByText("Janely"));

    expect(router.state.location.pathname).toBe("/charge/greyes%40wifiplus");
  });

  it("shows 'Sin resultados' when the list is empty", async () => {
    withSession();
    server.use(handlers.customerSearch(() => ok({ customers: [] })));
    renderApp("/");

    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "Nadie");

    expect(await screen.findByText(/sin resultados/i)).toBeInTheDocument();
  });
});

describe("US-C01: WispHub down shows the amber queue notice", () => {
  it("shows the queue notice on WISPHUB_UNAVAILABLE", async () => {
    withSession();
    server.use(handlers.customerSearch(() => fail("WISPHUB_UNAVAILABLE", 503)));
    renderApp("/");

    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "Janely");

    expect(await screen.findByText(/quedarán en cola/i)).toBeInTheDocument();
  });
});
