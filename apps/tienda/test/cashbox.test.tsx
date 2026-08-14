import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cashboxResponse } from "@devolada/api/cashbox-schema";
import { handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/cashbox/cashbox.spec.md scenarios 4–6. */

function cashbox(overrides: Partial<{ approaching: boolean; blocked: boolean }> = {}) {
  return cashboxResponse.parse({
    storeName: "Abarrotes La Esquina",
    balanceCents: 91000,
    commissionEarnedCents: 1800,
    cap: {
      capCents: 500000,
      approaching: overrides.approaching ?? false,
      blocked: overrides.blocked ?? false,
    },
    lastCashDrop: null,
  });
}

function mount(data: ReturnType<typeof cashbox>) {
  server.use(
    handlers.session(() => ok(storeActor)),
    handlers.cashbox(() => ok(data)),
  );
  return renderApp("/cashbox");
}

describe("US-K01: the screen shows the store, the balance and the commission", () => {
  it("renders store name and both amounts from the API", async () => {
    mount(cashbox());

    expect(
      await screen.findByRole("heading", { name: "Abarrotes La Esquina" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$910.00")).toBeInTheDocument();
    expect(screen.getByText("$18.00")).toBeInTheDocument();
    /* D2: the balance links to the entries it sums */
    expect(screen.getByRole("link", { name: /efectivo del isp/i })).toHaveAttribute(
      "href",
      "/ledger",
    );
  });
});

describe("US-K04: cap notices come from the API booleans", () => {
  it("shows the approaching notice", async () => {
    mount(cashbox({ approaching: true }));
    expect(await screen.findByText(/se acerca a su límite/i)).toBeInTheDocument();
  });

  it("shows the blocked notice instead when at the cap", async () => {
    mount(cashbox({ approaching: true, blocked: true }));
    expect(await screen.findByText(/llegó a su límite/i)).toBeInTheDocument();
    expect(screen.queryByText(/se acerca a su límite/i)).not.toBeInTheDocument();
  });
});

describe("D3: logout lives in Caja", () => {
  it("Cerrar sesión posts the logout and lands on /login", async () => {
    server.use(handlers.logout(() => ok({})));
    const router = mount(cashbox());

    await userEvent.click(await screen.findByRole("button", { name: /cerrar sesión/i }));

    expect(await screen.findByLabelText("Teléfono")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
