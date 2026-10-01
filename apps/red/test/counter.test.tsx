import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  cashbox,
  collection,
  fail,
  handlers,
  noDebt,
  ok,
  owes,
  quote,
  receipt,
  searchRows,
  searchUnavailable,
  server,
  storeMe,
} from "./msw";
import { renderApp } from "./render";
import { storeMeResponse } from "@devolada/api/store-schema";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US1 (T025) — the counter on the shopkeeper's phone: the
   search shows nothing before three characters and only name, usuario and
   zone after; the quote's breakdown; the amount never above the debt;
   AMOUNT_CHANGED re-asks; every outcome as icon + text; and a typed
   WhatsApp number that never reaches the API (FR-027). */

const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/lib/open", () => ({ openExternal: (url: string) => opened.urls.push(url) }));

const requests: string[] = [];
const onRequest = ({ request }: { request: Request }) => {
  void request
    .clone()
    .text()
    .then((body) => requests.push(`${request.method} ${request.url} ${body}`));
};

beforeEach(() => {
  opened.urls.length = 0;
  requests.length = 0;
  server.events.on("request:start", onRequest);
  server.use(handlers.session(() => ok(storeMe)));
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe("cash-at-stores US1 — the search", () => {
  it("shows a search box and no customers, and asks for three characters before searching", async () => {
    const { container } = renderApp("/");
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
    expect(screen.getByText("WiFi Plus")).toBeInTheDocument();
    expect(screen.getByText("Escribe al menos 3 letras o números.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Buscar cliente"), "gu");
    await new Promise((r) => setTimeout(r, 500));
    /* MSW would have failed on an unhandled search; and none was made */
    expect(requests.some((r) => r.includes("/store/customers"))).toBe(false);
    expect(screen.queryByRole("list", { name: "Clientes encontrados" })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("from three characters, each result shows name, usuario and zone — never a phone", async () => {
    let asked = "";
    server.use(
      handlers.search((url) => {
        asked = url.searchParams.get("q") ?? "";
        return ok(searchRows);
      }),
    );
    const { container } = renderApp("/");
    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "gua");
    const list = await screen.findByRole("list", { name: "Clientes encontrados" });
    expect(asked).toBe("gua");
    expect(within(list).getByText("Guadalupe Reyes")).toBeInTheDocument();
    expect(within(list).getByText("greyes@wifiplus · Centro")).toBeInTheDocument();
    expect(within(list).getByText("gruiz@wifiplus")).toBeInTheDocument();
    expect(list.textContent).not.toMatch(/\d{10}/);
    await expectNoViolations(container);
  });

  it("an outage says the business's system is not answering — never 'sin resultados' (FR-028)", async () => {
    server.use(handlers.search(() => ok(searchUnavailable)));
    renderApp("/");
    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "gua");
    expect(await screen.findByText(/El sistema de WiFi Plus no responde ahora/)).toBeInTheDocument();
    expect(screen.queryByText(/No encontramos clientes/)).not.toBeInTheDocument();
  });

  it("CHANNEL_OFF: no search box, the reason — and *Caja* still opens (L2)", async () => {
    server.use(
      handlers.session(() => ok(storeMeResponse.parse({ ...storeMe, businessName: null }))),
      handlers.cashbox(() => ok(cashbox())),
    );
    const { container } = renderApp("/");
    expect(await screen.findByText("Por ahora no hay negocios para cobrar en esta tienda.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar cliente")).not.toBeInTheDocument();
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("link", { name: "Caja" }));
    expect(await screen.findByText("Efectivo que tienes")).toBeInTheDocument();
  });
});

describe("cash-at-stores US1 — the quote and the confirmation", () => {
  it("shows the debt, the fee and the total, with *Cobrar $813.00* as the decisive action", async () => {
    server.use(handlers.quote(() => ok(owes)));
    const { container } = renderApp("/cobro/greyes%40wifiplus");
    expect(await screen.findByRole("heading", { name: "Guadalupe Reyes" })).toBeInTheDocument();
    expect(screen.getByText("Adeudo")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
    expect(screen.getByText("Total a cobrar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar $813.00" })).toBeEnabled();
    await expectNoViolations(container);
  });

  it("nothing owed is *Sin adeudo*, and nothing is offered", async () => {
    server.use(handlers.quote(() => ok(noDebt)));
    renderApp("/cobro/greyes%40wifiplus");
    expect(await screen.findByText("Sin adeudo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cobrar/ })).not.toBeInTheDocument();
  });

  it("refuses an amount above the debt and says the most it can collect (FR-019)", async () => {
    server.use(handlers.quote(() => ok(owes)));
    renderApp("/cobro/greyes%40wifiplus");
    const field = await screen.findByLabelText("Monto a cobrar del adeudo");
    await userEvent.clear(field);
    await userEvent.type(field, "900");
    expect(await screen.findByRole("alert")).toHaveTextContent("Lo más que puedes cobrar es $798.00.");
    expect(screen.getByRole("button", { name: /^Cobrar/ })).toBeDisabled();
  });

  it("a short amount below the business's rule says the service will not come back, before confirming", async () => {
    server.use(handlers.quote(() => ok(owes)));
    renderApp("/cobro/greyes%40wifiplus");
    const field = await screen.findByLabelText("Monto a cobrar del adeudo");
    await userEvent.clear(field);
    await userEvent.type(field, "500");
    expect(await screen.findByText(/Con este monto el servicio no se reactiva/)).toHaveTextContent("quedará a deber $298.00");
    expect(screen.getByText("Abono al adeudo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar $515.00" })).toBeEnabled();
  });

  it("AMOUNT_CHANGED shows the new amounts and asks again", async () => {
    let quotes = 0;
    server.use(
      handlers.quote(() => {
        quotes++;
        return ok(quotes === 1 ? owes : quote({ debtCents: 49900, invoiceCents: 49900, carriedBalanceCents: 0, totalCents: 51400, reconnectsFromCents: 49900 }));
      }),
      handlers.record(() => fail("AMOUNT_CHANGED", 409)),
    );
    renderApp("/cobro/greyes%40wifiplus");
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar $813.00" }));
    expect(await screen.findByText(/El adeudo o el cargo cambiaron/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Cobrar $514.00" })).toBeEnabled();
  });

  it("the record carries the amounts shown and one key, and lands on the result", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      handlers.quote(() => ok(owes)),
      handlers.record((b) => {
        body = b as Record<string, unknown>;
        return ok({ id: "pay-1", folio: "DV-7K2Q9M" }, 201);
      }),
      handlers.collection(() => ok(collection())),
    );
    renderApp("/cobro/greyes%40wifiplus");
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar $813.00" }));
    expect(await screen.findByText("DV-7K2Q9M")).toBeInTheDocument();
    expect(body).toMatchObject({ usuario: "greyes@wifiplus", amountCents: 79800, expectedDebtCents: 79800, expectedFeeCents: 1500 });
    expect(body.collectionKey).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("cash-at-stores US1 — the result", () => {
  const OUTCOMES = [
    ["reconnected", "Reconectado", /ya está activo/],
    ["registered", "Registrado", /no reactiva el servicio desde aquí/],
    ["queued", "Reconexión en cola", /en unos minutos/],
    ["not_reconnected_short", "Sin reactivar", /no alcanza para reactivar/],
    ["observation", "Observación", /a mano/],
    ["failed", "Fallido", /no pudimos avisar al negocio/i],
  ] as const;

  for (const [outcome, label, say] of OUTCOMES) {
    it(`${outcome}: icon + text`, async () => {
      server.use(handlers.collection(() => ok(collection({ outcome }))));
      const { container } = renderApp("/cobros/pay-1");
      const badge = await screen.findByText(label);
      expect(badge.querySelector("svg")).not.toBeNull();
      expect(screen.getByText(say)).toBeInTheDocument();
      await expectNoViolations(container);
    });
  }

  it("a short payment says what remains owed", async () => {
    server.use(handlers.collection(() => ok(collection({ class: "short", amountCents: 50000, remainingCents: 29800, outcome: "not_reconnected_short" }))));
    renderApp("/cobros/pay-1");
    expect(await screen.findByText("Queda por pagar")).toBeInTheDocument();
    expect(screen.getByText("$298.00")).toBeInTheDocument();
  });

  it("with a phone on file, *Enviar comprobante* opens the link the API built", async () => {
    server.use(
      handlers.collection(() => ok(collection())),
      handlers.receipt(() => ok(receipt({ hasPhone: true, waLink: "https://wa.me/523312345678?text=Comprobante" }))),
    );
    renderApp("/cobros/pay-1");
    await userEvent.click(await screen.findByRole("button", { name: "Enviar comprobante" }));
    await waitFor(() => expect(opened.urls).toEqual(["https://wa.me/523312345678?text=Comprobante"]));
  });

  it("with no phone, it asks for ten digits and builds wa.me/52… itself — the number never reaches the API (FR-027)", async () => {
    server.use(handlers.collection(() => ok(collection())), handlers.receipt(() => ok(receipt())));
    const { container } = renderApp("/cobros/pay-1");
    await userEvent.click(await screen.findByRole("button", { name: "Enviar comprobante" }));
    const field = await screen.findByLabelText("WhatsApp del cliente (10 dígitos)");
    await expectNoViolations(container);
    expect(screen.getByRole("button", { name: "Abrir WhatsApp" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "33 1234 5678" } });
    await userEvent.click(screen.getByRole("button", { name: "Abrir WhatsApp" }));
    expect(opened.urls).toEqual([`https://wa.me/523312345678?text=${encodeURIComponent(receipt().text)}`]);
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.join("\n")).not.toContain("3312345678");
  });

  it("*Usar otro número* asks for a number even when the system has one", async () => {
    server.use(handlers.collection(() => ok(collection())), handlers.receipt(() => ok(receipt({ hasPhone: true, waLink: "https://wa.me/525512345678?text=x" }))));
    renderApp("/cobros/pay-1");
    await userEvent.click(await screen.findByRole("button", { name: "Usar otro número" }));
    expect(await screen.findByLabelText("WhatsApp del cliente (10 dígitos)")).toBeInTheDocument();
    expect(opened.urls).toEqual([]);
  });
});
