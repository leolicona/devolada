import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { cashPointsResponse, handoverHistoryResponse } from "@devolada/api/cash-points-schema";
import { feedResponse } from "@devolada/api/payments-schema";
import { businessActor, fail, handlers, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US5 (FR-034, FR-035, FR-042; research D20, D23): the
   business's *Puntos de pago* — each store holding its cash, the amount,
   the last confirmed hand-over and the pending one. Confirming takes two
   taps and the second names the store and the amount; a dispute needs a
   note; a viewer reads and acts on nothing; the menu shows the page once
   the business has had cash at stores. Fixtures parse with the contract
   (constitution III). */

const at = Date.UTC(2026, 9, 1, 17, 0);
const withStores = { ...businessActor, storeChannel: { on: true, since: at - 86_400_000 } };

const points = cashPointsResponse.parse({
  channelOn: true,
  stores: [
    {
      storeId: "s1",
      storeName: "Abarrotes Lupita",
      address: "Av. Juárez 12, Centro",
      storeStatus: "active",
      heldCents: 120000,
      lastConfirmed: { cents: 50000, at: at - 7 * 86_400_000 },
      pending: { id: "h1", cents: 80000, declaredAt: at },
    },
    {
      storeId: "s2",
      storeName: "Papelería El Sol",
      address: "Calle 5 de Mayo 40",
      storeStatus: "suspended",
      heldCents: 30000,
      lastConfirmed: null,
      pending: null,
    },
  ],
});

const history = handoverHistoryResponse.parse({
  handovers: [
    { id: "h0", storeId: "s1", cents: 20000, status: "disputed", note: "Faltaron $200 en el sobre", declaredAt: at - 86_400_000, resolvedAt: at - 80_000_000, resolvedBy: "owner@isp.mx" },
  ],
  nextCursor: null,
});

const emptyFeed = feedResponse.parse({
  payments: [],
  nextCursor: null,
  effectiveOverTreatment: "flag",
  today: { count: 0, totalCents: 0, startedAtMs: 0 },
});

function arrange(actor: object = withStores) {
  server.use(handlers.session(() => ok(actor)), handlers.cashPoints(() => ok(points)), handlers.feed(() => ok(emptyFeed)));
  renderApp("/puntos-de-pago");
}

const card = (name: string) => screen.getByRole("heading", { name }).closest("div.space-y-4") as HTMLElement;

describe("cash-at-stores US5: Puntos de pago", () => {
  it("lists every store holding the business's cash, with the amount, the last hand-over and the pending one", async () => {
    arrange();
    expect(await screen.findByRole("heading", { name: "Abarrotes Lupita" })).toBeInTheDocument();
    const lupita = card("Abarrotes Lupita");
    expect(within(lupita).getByText("$1,200.00")).toBeInTheDocument();
    expect(within(lupita).getByText(/Última entrega confirmada: \$500\.00/)).toBeInTheDocument();
    expect(within(lupita).getByText(/La tienda declaró/)).toHaveTextContent("$800.00");
    expect(within(lupita).getByText("Entrega pendiente")).toBeInTheDocument();

    const sol = card("Papelería El Sol");
    expect(within(sol).getByText("$300.00")).toBeInTheDocument();
    expect(within(sol).queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("confirms in two taps, the second naming the store and the amount", async () => {
    const confirmed: string[] = [];
    arrange();
    server.use(
      handlers.confirmHandover((id) => {
        confirmed.push(id);
        return ok({ id, status: "confirmed" });
      }),
    );
    const lupita = await screen.findByRole("heading", { name: "Abarrotes Lupita" }).then(() => card("Abarrotes Lupita"));
    await userEvent.click(within(lupita).getByRole("button", { name: "Confirmar" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("¿Recibiste $800.00 de Abarrotes Lupita?");
    expect(within(dialog).getByText(/No se puede deshacer/)).toBeInTheDocument();
    expect(confirmed).toEqual([]);
    /* axe on the open dialog, as the feed's suites do: Radix's focus
       guards sit inside the page it hides */
    await expectNoViolations(dialog);

    await userEvent.click(within(dialog).getByRole("button", { name: "Sí, lo recibí" }));
    await waitFor(() => expect(confirmed).toEqual(["h1"]));
  });

  it("a second confirm that finds it resolved says so", async () => {
    arrange();
    server.use(handlers.confirmHandover(() => fail("HANDOVER_NOT_PENDING", 409)));
    await screen.findByRole("heading", { name: "Abarrotes Lupita" });
    await userEvent.click(within(card("Abarrotes Lupita")).getByRole("button", { name: "Confirmar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sí, lo recibí" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta entrega ya se resolvió.");
  });

  it("disputes with a note of 3 to 280 letters, which the store will read", async () => {
    const disputed: [string, unknown][] = [];
    arrange();
    server.use(
      handlers.disputeHandover((id, body) => {
        disputed.push([id, body]);
        return ok({ id, status: "disputed" });
      }),
    );
    await screen.findByRole("heading", { name: "Abarrotes Lupita" });
    await userEvent.click(within(card("Abarrotes Lupita")).getByRole("button", { name: "Disputar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/la tienda leerá esta nota/i)).toBeInTheDocument();
    const send = within(dialog).getByRole("button", { name: "Disputar entrega" });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Nota/), "no");
    expect(within(dialog).getByText("La nota debe tener de 3 a 280 letras.")).toBeInTheDocument();
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Nota/), " llegó completo: faltan $200");
    await expectNoViolations(dialog);
    await userEvent.click(send);
    await waitFor(() => expect(disputed).toEqual([["h1", { note: "no llegó completo: faltan $200" }]]));
  });

  it("shows the hand-over history with the dispute's note", async () => {
    arrange();
    server.use(handlers.handoverHistory(() => ok(history)));
    await screen.findByRole("heading", { name: "Abarrotes Lupita" });
    await userEvent.click(within(card("Abarrotes Lupita")).getByRole("button", { name: "Ver entregas" }));
    const list = await screen.findByRole("list", { name: "Entregas de Abarrotes Lupita" });
    expect(within(list).getByText("En disputa")).toBeInTheDocument();
    expect(within(list).getByText("«Faltaron $200 en el sobre»")).toBeInTheDocument();
    expect(within(list).getByText(/disputó owner@isp\.mx/)).toBeInTheDocument();
    /* T076: the day it was declared and the day it was resolved, not only the hour */
    expect(within(list).getByText(/declarada \d+ de [a-z]+/)).toBeInTheDocument();
    expect(within(list).getByText(/disputó owner@isp\.mx el \d+ de [a-z]+/)).toBeInTheDocument();
  });

  it("pages the hand-over history with *Cargar más* (T075)", async () => {
    arrange();
    const older = handoverHistoryResponse.parse({
      handovers: [{ id: "h-old", storeId: "s1", cents: 15000, status: "confirmed", note: null, declaredAt: at - 40 * 86_400_000, resolvedAt: at - 39 * 86_400_000, resolvedBy: "owner@isp.mx" }],
      nextCursor: null,
    });
    server.use(
      http.get("/cash-points/stores/:storeId/history", ({ request }) =>
        ok(new URL(request.url).searchParams.get("cursor") ? older : { ...history, nextCursor: "c1" }),
      ),
    );
    await screen.findByRole("heading", { name: "Abarrotes Lupita" });
    await userEvent.click(within(card("Abarrotes Lupita")).getByRole("button", { name: "Ver entregas" }));
    const list = await screen.findByRole("list", { name: "Entregas de Abarrotes Lupita" });
    await userEvent.click(within(card("Abarrotes Lupita")).getByRole("button", { name: "Cargar más" }));
    expect(await within(list).findByText("$150.00")).toBeInTheDocument();
  });

  it("a viewer reads everything and sees no buttons to act (FR-035)", async () => {
    arrange({ ...withStores, role: "viewer" });
    await screen.findByRole("heading", { name: "Abarrotes Lupita" });
    expect(screen.getByText(/La tienda declaró/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disputar" })).not.toBeInTheDocument();
  });

  it("the menu entry appears once the business has had cash at stores (D7, D23)", async () => {
    server.use(handlers.session(() => ok(withStores)), handlers.feed(() => ok(emptyFeed)));
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.getAllByRole("link", { name: /puntos de pago/i }).length).toBeGreaterThan(0);
  });

  it("a business that never had the channel sees no menu entry", async () => {
    server.use(handlers.session(() => ok(businessActor)), handlers.feed(() => ok(emptyFeed)));
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.queryByRole("link", { name: /puntos de pago/i })).not.toBeInTheDocument();
  });
});
