import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { delay, http } from "msw";
import { cashboxResponse } from "@devolada/api/cashbox-schema";
import { ledgerResponse } from "@devolada/api/ledger-schema";
import { handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/store-pwa/shell.spec.md scenario 6 (D7): a screen that waits
   holds its shape. The responses are delayed on purpose so the pending
   state is observable — without it the skeleton can mount and unmount
   between two polls and the test would pass by luck. */

const slow = (path: string, data: unknown) =>
  http.get(path, async () => {
    await delay(40);
    return ok(data);
  });

const cashbox = cashboxResponse.parse({
  storeName: "Abarrotes La Esquina",
  balanceCents: 91000,
  commissionEarnedCents: 1800,
  commissionSince: null,
  cap: { capCents: 500000, approaching: false, blocked: false },
  lastCashDrop: null,
});

describe("US-K01: the cash box loads without losing its shape", () => {
  it("shows skeletons while the balance travels, then the real numbers", async () => {
    server.use(handlers.session(() => ok(storeActor)), slow("/cashbox", cashbox));
    renderApp("/cashbox");

    const loading = await screen.findByLabelText("Cargando tu caja");
    expect(loading).toHaveAttribute("aria-busy", "true");
    /* Nothing invented while waiting: no zero balance on screen */
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();

    expect(await screen.findByText("$910.00")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByLabelText("Cargando tu caja")).not.toBeInTheDocument(),
    );
  });
});

describe("US-K03: the ledger loads without losing its shape", () => {
  it("shows row skeletons, then the entries", async () => {
    const ledger = ledgerResponse.parse({
      entries: [
        {
          id: "le-1",
          type: "charge",
          cents: 41400,
          createdAt: Date.UTC(2026, 7, 14, 18),
          reference: { chargeId: "ch-1", folio: "DV-AAA111", customerName: "Janely" },
        },
      ],
      nextCursor: null,
    });
    server.use(handlers.session(() => ok(storeActor)), slow("/ledger", ledger));
    renderApp("/ledger");

    expect(await screen.findByLabelText("Cargando tus movimientos")).toBeInTheDocument();
    /* The heading is already there: only the rows are pending */
    expect(screen.getByRole("heading", { name: "Movimientos" })).toBeInTheDocument();

    expect(await screen.findByText(/Janely/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByLabelText("Cargando tus movimientos")).not.toBeInTheDocument(),
    );
  });
});
