import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ledgerResponse } from "@devolada/api/ledger-schema";
import { fail, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/polish/list-states.spec.md scenarios 3–4. */

const entry = (id: string, cents: number) => ({
  id,
  type: "charge" as const,
  cents,
  createdAt: Date.UTC(2026, 7, 14, 20, 30),
  reference: { folio: `DV-${id}`, customerName: "Janely" },
});

const page = (ids: string[], nextCursor: number | null) =>
  ledgerResponse.parse({
    entries: ids.map((id) => entry(id, 41400)),
    nextCursor,
  });

describe("US-P01: Movimientos does not claim to be empty when it failed", () => {
  it("shows the error with a retry, not the empty sentence", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() => fail("INTERNAL_SERVER_ERROR", 500)),
    );
    renderApp("/ledger");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar tus movimientos/i);
    /* What a shopkeeper used to read after a dropped connection */
    expect(screen.queryByText(/todavía no tienes movimientos/i)).not.toBeInTheDocument();
  });

  it("keeps the honest empty state for a store with no entries yet", async () => {
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() => ok(page([], null))),
    );
    renderApp("/ledger");

    expect(await screen.findByText(/todavía no tienes movimientos/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries into the loaded list", async () => {
    let failNext = true;
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() => {
        if (failNext) {
          failNext = false;
          return fail("INTERNAL_SERVER_ERROR", 500);
        }
        return ok(page(["e1"], null));
      }),
    );
    renderApp("/ledger");

    await userEvent.click(await screen.findByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("Cobro · Janely")).toBeInTheDocument();
    expect(screen.queryByText(/no pudimos cargar/i)).not.toBeInTheDocument();
  });
});

describe("US-P01: a failed second page keeps the first one on screen", () => {
  it("reports under the rows instead of replacing them (D5)", async () => {
    let call = 0;
    server.use(
      handlers.session(() => ok(storeActor)),
      handlers.ledger(() => {
        call += 1;
        /* First page loads; "Cargar más" fails */
        return call === 1 ? ok(page(["e1"], 1786687200000)) : fail("INTERNAL_SERVER_ERROR", 500);
      }),
    );
    renderApp("/ledger");

    await userEvent.click(await screen.findByRole("button", { name: /cargar más/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar más movimientos/i);
    /* The row the shopkeeper was reading is still there */
    expect(screen.getByText("Cobro · Janely")).toBeInTheDocument();
  });
});
