import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cashbox, fail, handoverList, handlers, ledger, ok, server, storeMe } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US5 (FR-036–FR-038; research D19, D20) — the store's
   side of the cash book: *Mi caja* says what is held for each business and
   the fees earned since the last confirmed hand-over, and each number
   opens the movements behind it (FR-037); the pending and the last
   hand-over, with the business's note on a dispute; *Registrar entrega*
   starts at the whole amount and refuses more than is held; *Movimientos*
   groups by day and loads twenty more at a time. */

const day = (d: number, h = 18) => Date.UTC(2026, 8, d, h, 0);

beforeEach(() => {
  server.use(handlers.session(() => ok(storeMe)));
});
afterEach(() => server.events.removeAllListeners());

describe("cash-at-stores US5 — Mi caja", () => {
  it("shows the cash held and the fees since the last hand-over, each a way into its movements", async () => {
    const asked: URL[] = [];
    server.use(
      handlers.cashbox(() => ok(cashbox())),
      handlers.ledger((url) => {
        asked.push(url);
        return ok(ledger([]));
      }),
    );
    const { router, container } = renderApp("/caja");
    expect(await screen.findByRole("heading", { name: "WiFi Plus" })).toBeInTheDocument();
    const held = screen.getByRole("link", { name: /Efectivo que tienes \$4,350\.00/ });
    expect(screen.getByRole("link", { name: /Tus cargos desde la última entrega \$45\.00/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar entrega" })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(held);
    await waitFor(() => expect(router.state.location.pathname).toBe("/movimientos"));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get("businessId")).toBe("business-1"));
    expect(asked.at(-1)!.searchParams.has("kind")).toBe(false);
  });

  it("the fees open only the collections of that business", async () => {
    const asked: URL[] = [];
    server.use(
      handlers.cashbox(() => ok(cashbox())),
      handlers.ledger((url) => {
        asked.push(url);
        return ok(ledger([]));
      }),
    );
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("link", { name: /Tus cargos desde la última entrega/ }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get("kind")).toBe("collection"));
    expect(asked.at(-1)!.searchParams.get("businessId")).toBe("business-1");
    expect(await screen.findByText(/Solo tus cobros/)).toBeInTheDocument();
  });

  it("a pending hand-over waits on the business, and no second one can be declared", async () => {
    server.use(handlers.cashbox(() => ok(cashbox({ pendingHandover: { id: "h1", cents: 200000, declaredAt: day(28) } }))));
    const { container } = renderApp("/caja");
    expect(await screen.findByText("Entrega pendiente")).toBeInTheDocument();
    expect(screen.getByText(/Entregaste \$2,000\.00 el 28 sep/)).toHaveTextContent("Esperamos a que WiFi Plus la confirme.");
    expect(screen.getByRole("link", { name: "Registrar entrega" })).toHaveAttribute("aria-disabled", "true");
    await expectNoViolations(container);
  });

  it("after a hand-over, the fees open only the collections since it (T079, FR-037)", async () => {
    const asked: URL[] = [];
    server.use(
      handlers.cashbox(() => ok(cashbox({ feesSince: day(24), lastHandover: { cents: 390000, status: "confirmed", at: day(24), note: null } }))),
      handlers.ledger((url) => {
        asked.push(url);
        return ok(ledger([]));
      }),
    );
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("link", { name: /Tus cargos desde la última entrega/ }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get("since")).toBe(String(day(24))));
    expect(asked.at(-1)!.searchParams.get("kind")).toBe("collection");
    expect(await screen.findByText(/Tus cobros desde la última entrega/)).toBeInTheDocument();
  });

  it("the last hand-over opens every hand-over to that business — a dispute's note stays readable after the next one (T080, US5/AC6)", async () => {
    const asked: URL[] = [];
    server.use(
      handlers.cashbox(() => ok(cashbox({ lastHandover: { cents: 390000, status: "confirmed", at: day(24), note: null } }))),
      handlers.handovers((url) => {
        asked.push(url);
        return ok(
          handoverList([
            { id: "h3", cents: 390000, status: "confirmed", declaredAt: day(24, 12), resolvedAt: day(24), note: null },
            { id: "h1", cents: 200000, status: "disputed", declaredAt: day(17, 12), resolvedAt: day(17, 19), note: "Faltaron $200 en el sobre" },
          ]),
        );
      }),
    );
    const { container } = renderApp("/caja");
    await userEvent.click(await screen.findByRole("link", { name: /Última entrega: \$3,900\.00/ }));
    const list = await screen.findByRole("list", { name: "Entregas a WiFi Plus" });
    expect(asked.at(-1)!.searchParams.get("businessId")).toBe("business-1");
    expect(within(list).getByText("En disputa")).toBeInTheDocument();
    expect(within(list).getByText("WiFi Plus dice: «Faltaron $200 en el sobre»")).toBeInTheDocument();
    expect(within(list).getAllByText(/WiFi Plus la (confirmó|disputó) el/)).toHaveLength(2);
    await expectNoViolations(container);
  });

  it("a disputed hand-over shows the business's note to the store", async () => {
    server.use(
      handlers.cashbox(() =>
        ok(cashbox({ lastHandover: { cents: 150000, status: "disputed", at: day(27), note: "Faltaron $200 en el sobre" } })),
      ),
    );
    const { container } = renderApp("/caja");
    expect(await screen.findByText("En disputa")).toBeInTheDocument();
    expect(screen.getByText(/Última entrega: \$1,500\.00/)).toBeInTheDocument();
    expect(screen.getByText("WiFi Plus dice: «Faltaron $200 en el sobre»")).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("a confirmed hand-over reads as such, with no note", async () => {
    server.use(handlers.cashbox(() => ok(cashbox({ lastHandover: { cents: 150000, status: "confirmed", at: day(27), note: null } }))));
    renderApp("/caja");
    expect(await screen.findByText("Entrega confirmada")).toBeInTheDocument();
    expect(screen.queryByText(/dice:/)).not.toBeInTheDocument();
  });

  it("with nothing held, there is nothing to hand over", async () => {
    server.use(handlers.cashbox(() => ok(cashbox({ heldCents: 0, feesSinceHandoverCents: 0 }))));
    renderApp("/caja");
    expect(await screen.findByRole("link", { name: "Registrar entrega" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("cash-at-stores US5 — Registrar entrega", () => {
  it("starts at the whole amount held, says it stays pending, and declares it", async () => {
    const declared: unknown[] = [];
    let held = cashbox();
    server.use(
      handlers.cashbox(() => ok(held)),
      handlers.handover((body) => {
        declared.push(body);
        held = cashbox({ pendingHandover: { id: "h9", cents: 435000, declaredAt: day(30) } });
        return ok({ id: "h9", status: "pending" }, 201);
      }),
    );
    const { router, container } = renderApp("/caja/entrega?businessId=business-1");
    expect(await screen.findByRole("heading", { name: "Registrar entrega" })).toBeInTheDocument();
    expect(screen.getByLabelText("Monto que entregaste")).toHaveValue("4350.00");
    expect(
      screen.getByText("La entrega quedará pendiente hasta que el negocio confirme que recibió el efectivo."),
    ).toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Registrar entrega de $4,350.00" }));
    await waitFor(() => expect(declared).toEqual([{ businessId: "business-1", cents: 435000 }]));
    await waitFor(() => expect(router.state.location.pathname).toBe("/caja"));
    expect(await screen.findByText("Entrega pendiente")).toBeInTheDocument();
  });

  it("refuses zero and more than is held, before sending", async () => {
    server.use(handlers.cashbox(() => ok(cashbox())));
    renderApp("/caja/entrega?businessId=business-1");
    const amount = await screen.findByLabelText("Monto que entregaste");

    await userEvent.clear(amount);
    await userEvent.type(amount, "0");
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un monto mayor a $0.");
    expect(screen.getByRole("button", { name: /Registrar entrega de/ })).toBeDisabled();

    await userEvent.clear(amount);
    await userEvent.type(amount, "5000");
    expect(screen.getByRole("alert")).toHaveTextContent("Lo más que puedes entregar es $4,350.00.");
    expect(screen.getByRole("button", { name: /Registrar entrega de/ })).toBeDisabled();

    await userEvent.clear(amount);
    await userEvent.type(amount, "1000");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar entrega de $1,000.00" })).toBeEnabled();
  });

  it("says when a hand-over is already pending (HANDOVER_PENDING)", async () => {
    server.use(handlers.cashbox(() => ok(cashbox())), handlers.handover(() => fail("HANDOVER_PENDING", 409)));
    renderApp("/caja/entrega?businessId=business-1");
    await userEvent.click(await screen.findByRole("button", { name: /Registrar entrega de/ }));
    expect(
      await screen.findByText("Ya tienes una entrega pendiente con este negocio. Espera a que la confirme."),
    ).toBeInTheDocument();
  });

  it("says when the amount is more than the server holds (AMOUNT_EXCEEDS_HELD)", async () => {
    server.use(handlers.cashbox(() => ok(cashbox())), handlers.handover(() => fail("AMOUNT_EXCEEDS_HELD", 409)));
    renderApp("/caja/entrega?businessId=business-1");
    await userEvent.click(await screen.findByRole("button", { name: /Registrar entrega de/ }));
    expect(await screen.findByText("Es más de lo que tienes de este negocio.")).toBeInTheDocument();
  });
});

describe("cash-at-stores US5 — Movimientos", () => {
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

  it("groups by day, newest first, and loads more on Cargar más", async () => {
    const asked: URL[] = [];
    server.use(
      handlers.ledger((url) => {
        asked.push(url);
        return url.searchParams.get("cursor") === "next"
          ? ok(ledger([row("OLD1", day(20), { kind: "correction", cents: -5000, folio: "DV-X", customerName: null, feeCents: null, reason: "Se capturó $50 de más" })]))
          : ok(
              ledger(
                [
                  row("A1", day(29, 20)),
                  row("H1", day(29, 19), { kind: "handover", cents: -200000, folio: null, customerName: null, feeCents: null }),
                  row("A2", day(28)),
                ],
                "next",
              ),
            );
      }),
    );
    const { container } = renderApp("/movimientos");
    const first = await screen.findByRole("heading", { name: /29 de septiembre/ });
    const firstDay = within(first.parentElement!).getByRole("list");
    expect(within(firstDay).getAllByRole("listitem")).toHaveLength(2);
    expect(within(firstDay).getByText("Cobro · Guadalupe Reyes")).toBeInTheDocument();
    expect(within(firstDay).getByText(/cargo tuyo \$15\.00/)).toBeInTheDocument();
    expect(within(firstDay).getByText("Entrega a WiFi Plus")).toBeInTheDocument();
    expect(within(firstDay).getByText("−$2,000.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /28 de septiembre/ })).toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("heading", { name: /20 de septiembre/ })).toBeInTheDocument();
    expect(screen.getByText("Corrección de Devolada")).toBeInTheDocument();
    expect(screen.getByText("Se capturó $50 de más")).toBeInTheDocument();
    expect(asked.at(-1)!.searchParams.get("cursor")).toBe("next");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument());
  });

  it("an empty book says so", async () => {
    server.use(handlers.ledger(() => ok(ledger([]))));
    renderApp("/movimientos");
    expect(await screen.findByText("Aún no hay movimientos.")).toBeInTheDocument();
  });
});
