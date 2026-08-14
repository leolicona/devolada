import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { adminCashDrop, cashDropsResponse } from "@devolada/api/cash-drops-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/cash-drops/confirm-cash-drop.spec.md scenarios 5–6. */

const drop = (over: Record<string, unknown> = {}) =>
  adminCashDrop.parse({
    id: "cd-1",
    storeId: "st-1",
    storeName: "Abarrotes La Esquina",
    storeZone: "Col. El Mirador",
    cents: 50600,
    status: "pending",
    note: null,
    createdAt: 1_800_000_000_000,
    confirmedAt: null,
    storeBalanceCents: 50600,
    ...over,
  });

const page = (drops: unknown[]) => cashDropsResponse.parse({ drops, nextCursor: null });

/* One handler for both scopes, driven by the query param the screen sends. */
const lists = (pending: unknown[], resolved: unknown[] = []) =>
  handlers.cashDrops((url) =>
    ok(page(url.searchParams.get("scope") === "resolved" ? resolved : pending)),
  );

describe("US-E01: confirming a cash drop takes two taps", () => {
  it("confirms through the dialog and the card leaves the pending list", async () => {
    let confirmed = false;
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.cashDrops((url) => {
        if (url.searchParams.get("scope") === "resolved") {
          return ok(page(confirmed ? [drop({ status: "confirmed", confirmedAt: 1_800_000_100_000, storeBalanceCents: null })] : []));
        }
        return ok(page(confirmed ? [] : [drop()]));
      }),
      handlers.confirmCashDrop(() => {
        confirmed = true;
        return ok({
          drop: drop({ status: "confirmed", confirmedAt: 1_800_000_100_000 }),
          storeBalanceCents: 0,
        });
      }),
    );
    renderApp("/cash-drops");

    expect(await screen.findByText("Abarrotes La Esquina")).toBeInTheDocument();
    /* D5: the ISP counts the cash against what the store still holds */
    expect(screen.getByText(/saldo actual de la tienda/i)).toBeInTheDocument();

    /* Tap 1 opens the dialog — no write yet (D6) */
    await userEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }));
    const dialog = await screen.findByRole("alertdialog");
    /* The dialog names the store and the amount — a mis-tap can be caught */
    expect(dialog).toHaveTextContent("¿Recibiste $506.00 de Abarrotes La Esquina?");
    expect(confirmed).toBe(false);

    /* Tap 2 writes it */
    await userEvent.click(within(dialog).getByRole("button", { name: /sí, la recibí/i }));
    expect(await screen.findByText("No hay entregas por confirmar.")).toBeInTheDocument();
    expect(screen.getByText("Entrega confirmada")).toBeInTheDocument();
  });
});

describe("US-E02: a dispute needs a reason", () => {
  it("blocks an empty note and shows the disputed drop with its reason", async () => {
    const sent: unknown[] = [];
    let disputed = false;
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.cashDrops((url) => {
        if (url.searchParams.get("scope") === "resolved") {
          return ok(
            page(
              disputed
                ? [drop({ status: "disputed", note: "Faltaron $200 en el sobre.", storeBalanceCents: null })]
                : [],
            ),
          );
        }
        return ok(page(disputed ? [] : [drop()]));
      }),
      handlers.disputeCashDrop((body) => {
        sent.push(body);
        disputed = true;
        return ok({ drop: drop({ status: "disputed", note: "Faltaron $200 en el sobre." }) });
      }),
    );
    renderApp("/cash-drops");

    await userEvent.click(await screen.findByRole("button", { name: /marcar en disputa/i }));
    await userEvent.click(await screen.findByRole("button", { name: /enviar disputa/i }));
    expect(await screen.findByText(/escribe qué pasó/i)).toBeInTheDocument();
    expect(sent).toHaveLength(0);

    await userEvent.type(
      screen.getByLabelText(/qué pasó con esta entrega/i),
      "Faltaron $200 en el sobre.",
    );
    await userEvent.click(screen.getByRole("button", { name: /enviar disputa/i }));

    expect(sent).toEqual([{ note: "Faltaron $200 en el sobre." }]);
    expect(await screen.findByText("En disputa")).toBeInTheDocument();
    expect(screen.getByText("Faltaron $200 en el sobre.")).toBeInTheDocument();
  });
});

describe("US-E01: the sidebar says how many drops wait", () => {
  it("shows the pending count next to Entregas", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      lists([drop(), drop({ id: "cd-2", storeName: "Miscelánea Lupita" })]),
    );
    renderApp("/cash-drops");

    /* One label per surface: sidebar and bottom bar both carry it (D8) */
    const badges = await screen.findAllByLabelText("2 entregas pendientes");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]).toHaveTextContent("2");
  });
});
