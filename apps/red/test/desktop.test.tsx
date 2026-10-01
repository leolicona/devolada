import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cashbox, collection, handlers, handoverList, ledger, ok, owes, searchRows, server, storeMe } from "./msw";
import { atWidth, renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US1, US5 (FR-012 as amended 2026-10-01; research D32) —
   the store app on a computer. From 1024px the sections are a side menu;
   *Cobrar* keeps the search beside the debt and the payment; *Mi caja*
   keeps the hand-overs beside the cash; *Registrar entrega* sits beside
   the business's card; *Movimientos* is a table per day. The section is
   the h1 and each half an h2. Geometry (side by side, 48px, no sideways
   scroll) is the browser layer's: tests/e2e/responsive.spec.ts. */

const day = (d: number, h = 18) => Date.UTC(2026, 8, d, h, 0);

beforeEach(() => {
  atWidth(1280);
  server.use(handlers.session(() => ok(storeMe)));
});

describe("cash-at-stores US1 — the frame on a computer (D32)", () => {
  it("the sections are a side menu under the store's name, the current one marked", async () => {
    const { container } = renderApp("/");
    const side = await screen.findByRole("navigation", { name: "Secciones" });
    expect(screen.getByText("Abarrotes Lupita")).toBeInTheDocument();
    expect(within(side).getByRole("link", { name: "Cobrar" })).toHaveAttribute("aria-current", "page");
    expect(within(side).getByRole("link", { name: "Caja" })).not.toHaveAttribute("aria-current");
    expect(within(side).getByRole("link", { name: "Movimientos" })).not.toHaveAttribute("aria-current");
    await expectNoViolations(container);
  });
});

describe("cash-at-stores US1 — Cobrar in two halves (D32)", () => {
  it("the search stays beside the debt, with the chosen customer marked and the section as the h1", async () => {
    server.use(
      handlers.search(() => ok(searchRows)),
      handlers.quote(() => ok(owes)),
    );
    const { container } = renderApp("/");
    expect(await screen.findByText(/Busca a un cliente para ver aquí su adeudo/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Buscar cliente"), "gua");
    const list = await screen.findByRole("list", { name: "Clientes encontrados" });
    await userEvent.click(within(list).getByRole("link", { name: /Guadalupe Reyes/ }));

    expect(await screen.findByRole("heading", { level: 2, name: "Guadalupe Reyes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Cobrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar cliente")).toHaveValue("gua");
    const results = screen.getByRole("list", { name: "Clientes encontrados" });
    expect(within(results).getByRole("link", { name: /Guadalupe Reyes/ })).toHaveAttribute("aria-current", "page");
    expect(within(results).getByRole("link", { name: /Gabriel Ruiz/ })).not.toHaveAttribute("aria-current");
    /* the search is in view: no way back to it is offered */
    expect(screen.queryByRole("link", { name: "Buscar otro cliente" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cobrar $813.00" })).toBeEnabled();
    await expectNoViolations(container);
  });

  it("a recorded payment shows beside an empty search, and *Nuevo cobro* starts over", async () => {
    server.use(
      handlers.search(() => ok(searchRows)),
      handlers.quote(() => ok(owes)),
      handlers.record(() => ok({ id: "pay-1", folio: "DV-7K2Q9M" }, 201)),
      handlers.collection(() => ok(collection())),
    );
    const { container } = renderApp("/");
    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "gua");
    await userEvent.click(await screen.findByRole("link", { name: /Guadalupe Reyes/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar $813.00" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Pago registrado" })).toBeInTheDocument();
    expect(screen.getByText("DV-7K2Q9M")).toBeInTheDocument();
    /* that search is over; the focus is not pulled from the payment */
    expect(screen.getByLabelText("Buscar cliente")).toHaveValue("");
    expect(screen.getByLabelText("Buscar cliente")).not.toHaveFocus();
    await expectNoViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Nuevo cobro" }));
    expect(await screen.findByText(/Busca a un cliente para ver aquí su adeudo/)).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar cliente")).toHaveValue("");
  });
});

describe("cash-at-stores US5 — the cash book on a computer (D32)", () => {
  const disputed = handoverList([
    { id: "h3", cents: 390000, status: "confirmed", declaredAt: day(24, 12), resolvedAt: day(24), note: null },
    { id: "h1", cents: 200000, status: "disputed", declaredAt: day(17, 12), resolvedAt: day(17, 19), note: "Faltaron $200 en el sobre" },
  ]);

  it("*Mi caja*: the cash on the left, the hand-overs and the dispute's note on the right", async () => {
    server.use(
      handlers.cashbox(() => ok(cashbox({ lastHandover: { cents: 390000, status: "confirmed", at: day(24), note: null }, feesSince: day(24) }))),
      handlers.handovers(() => ok(disputed)),
    );
    const { container } = renderApp("/caja");
    expect(await screen.findByRole("heading", { level: 1, name: "Mi caja" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Entregas a WiFi Plus" });
    expect(screen.getByRole("heading", { level: 2, name: "Entregas a WiFi Plus" })).toBeInTheDocument();
    expect(within(list).getByText("WiFi Plus dice: «Faltaron $200 en el sobre»")).toBeInTheDocument();
    /* a sentence ending on "p.m." takes no second period (measured
       2026-10-01 on the desktop screenshot, "2:35 p.m..") */
    expect(list.textContent).not.toMatch(/\.\./);
    /* the history is beside it: the last hand-over is a line, not a way
       to the same list */
    expect(screen.getByText(/Última entrega: \$3,900\.00/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Última entrega/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Registrar entrega" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("*Registrar entrega*: the business's card beside the form, and *Cancelar* back to Mi caja", async () => {
    server.use(
      handlers.cashbox(() => ok(cashbox())),
      handlers.handovers(() => ok(handoverList([]))),
    );
    const { container, router } = renderApp("/caja/entrega?businessId=business-1");
    expect(await screen.findByRole("heading", { level: 2, name: "Registrar entrega" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Mi caja" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Efectivo que tienes \$4,350\.00/ })).toBeInTheDocument();
    /* the form is the action: the card offers no second one */
    expect(screen.queryByRole("link", { name: "Registrar entrega" })).toBeNull();
    expect(screen.getByRole("button", { name: "Registrar entrega de $4,350.00" })).toBeEnabled();
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("link", { name: "Cancelar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/caja"));
  });

  it("*Movimientos*: a table per day — hour, movement, folio, the store's fee and the amount", async () => {
    const row = (id: string, at: number, over: Record<string, unknown> = {}) => ({
      id,
      kind: "collection",
      cents: 79800,
      at,
      businessId: "business-1",
      businessName: "WiFi Plus",
      folio: `DV-${id}`,
      customerName: "Guadalupe Reyes",
      feeCents: 1500,
      reason: null,
      ...over,
    });
    server.use(
      handlers.ledger(() =>
        ok(
          ledger([
            row("A1", day(30, 20)),
            row("C1", day(30, 19), { kind: "correction", cents: -5000, customerName: null, feeCents: null, reason: "Se capturó $50 de más" }),
          ]),
        ),
      ),
    );
    const { container } = renderApp("/movimientos");
    const [table] = await screen.findAllByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Hora", "Movimiento", "Folio", "Tu cargo", "Monto"]);
    /* named by its day's heading */
    const dayHeading = screen.getAllByRole("heading", { level: 2 })[0];
    expect(table).toHaveAccessibleName(dayHeading.textContent ?? "");
    const [, collected, corrected] = within(table).getAllByRole("row");
    expect(within(collected).getByText("Cobro · Guadalupe Reyes")).toBeInTheDocument();
    expect(within(collected).getByText("DV-A1")).toBeInTheDocument();
    expect(within(collected).getByText("$15.00")).toBeInTheDocument();
    expect(within(collected).getByText("+$798.00")).toBeInTheDocument();
    expect(within(corrected).getByText("Corrección de Devolada")).toBeInTheDocument();
    expect(within(corrected).getByText("Se capturó $50 de más")).toBeInTheDocument();
    expect(within(corrected).getByText("−$50.00")).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
