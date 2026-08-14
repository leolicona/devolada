import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cashboxResponse } from "@devolada/api/cashbox-schema";
import { cashDropResponse } from "@devolada/api/cash-drops-schema";
import { ledgerResponse } from "@devolada/api/ledger-schema";
import { fail as failResponse, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/cashbox/cash-drop-and-ledger.spec.md scenarios 4–6. */

const cashbox = (
  balanceCents: number,
  lastCashDrop: Record<string, unknown> | null = null,
) =>
  cashboxResponse.parse({
    storeName: "Abarrotes La Esquina",
    balanceCents,
    commissionEarnedCents: 900,
    cap: { capCents: 500000, approaching: false, blocked: false },
    lastCashDrop,
  });

const pendingDrop = {
  id: "drop-1",
  cents: 40000,
  status: "pending",
  note: null,
  createdAt: Date.now(),
};

describe("US-K02: the drop form travels from Caja and back", () => {
  it("prefills the balance, submits, and Caja shows the pending drop", async () => {
    let dropped = false;
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.cashbox(() => ok(cashbox(40000, dropped ? pendingDrop : null))),
      handlers.recordDrop(() => {
        dropped = true;
        return ok(
          cashDropResponse.parse({
            id: "drop-1",
            cents: 40000,
            status: "pending",
            createdAt: Date.now(),
          }),
          201,
        );
      }),
    );
    const router = renderApp("/cashbox");

    /* travel: Caja → Registrar entrega (TESTING.md rule 7) */
    await userEvent.click(await screen.findByRole("link", { name: /registrar entrega/i }));

    const input = await screen.findByLabelText("Monto a entregar");
    expect(input).toHaveValue("400.00");
    await userEvent.click(screen.getByRole("button", { name: /registrar entrega/i }));

    expect(await screen.findByText("Entrega pendiente")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/cashbox");
  });

  it("an amount above the balance shows a plain error and does not submit", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.cashbox(() => ok(cashbox(40000))),
    );
    renderApp("/cashbox/drop");

    const input = await screen.findByLabelText("Monto a entregar");
    await userEvent.clear(input);
    await userEvent.type(input, "500.00");
    await userEvent.click(screen.getByRole("button", { name: /registrar entrega/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/mayor a tu balance/i);
  });
});

/* docs/cash-drops/confirm-cash-drop.spec.md scenario 7. */
describe("US-E02: the store reads the dispute the ISP wrote", () => {
  it("shows the note under the disputed drop in Caja", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.cashbox(() =>
        ok(
          cashbox(40000, {
            ...pendingDrop,
            status: "disputed",
            note: "Faltaron $200 en el sobre.",
          }),
        ),
      ),
    );
    renderApp("/cashbox");

    expect(await screen.findByText("En disputa")).toBeInTheDocument();
    expect(screen.getByText("Faltaron $200 en el sobre.")).toBeInTheDocument();
  });
});

describe("US-K03: Movimientos shows labeled rows", () => {
  it("renders charge context, signed amounts and folio", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() =>
        ok(
          ledgerResponse.parse({
            entries: [
              {
                id: "e1",
                type: "charge",
                cents: 41400,
                createdAt: Date.now(),
                reference: { folio: "DV-TEST01", customerName: "Janely" },
              },
              {
                id: "e2",
                type: "commission",
                cents: -900,
                createdAt: Date.now(),
                reference: { folio: "DV-TEST01", customerName: "Janely" },
              },
            ],
            nextCursor: null,
          }),
        ),
      ),
    );
    renderApp("/ledger");

    expect(await screen.findByText("Cobro · Janely")).toBeInTheDocument();
    expect(screen.getByText("Comisión")).toBeInTheDocument();
    expect(screen.getByText("+$414.00")).toBeInTheDocument();
    expect(screen.getByText("−$9.00")).toBeInTheDocument();
    expect(screen.getAllByText(/DV-TEST01/)).toHaveLength(2);
  });

  it("shows the honest empty state for a new store", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() => ok(ledgerResponse.parse({ entries: [], nextCursor: null }))),
    );
    renderApp("/ledger");

    expect(await screen.findByText(/todavía no tienes movimientos/i)).toBeInTheDocument();
  });
});
