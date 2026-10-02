import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
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
    /* both menus are in the page (D32); a phone shows the bar */
    const bar = screen.getByRole("navigation", { name: "Secciones, barra inferior" });
    await userEvent.click(within(bar).getByRole("link", { name: "Caja" }));
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

  it("after a payment, the same customer's quote is read again — never the debt from before (T081, FR-018)", async () => {
    let quotes = 0;
    let release: () => void = () => {};
    server.use(
      handlers.quote(async () => {
        quotes += 1;
        if (quotes === 1) return ok(owes);
        /* the second read is slow; the old amount must not show meanwhile */
        await new Promise<void>((r) => (release = r));
        return ok(noDebt);
      }),
      handlers.record(() => ok({ id: "pay-1", folio: "DV-7K2Q9M" }, 201)),
      handlers.collection(() => ok(collection())),
    );
    const { router } = renderApp("/cobro/greyes%40wifiplus");
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar $813.00" }));
    expect(await screen.findByText("DV-7K2Q9M")).toBeInTheDocument();
    void router.navigate({ to: "/cobro/$usuario", params: { usuario: "greyes@wifiplus" } });
    await waitFor(() => expect(quotes).toBe(2));
    expect(screen.queryByRole("button", { name: /Cobrar \$813\.00/ })).toBeNull();
    expect(screen.queryByText("$798.00")).toBeNull();
    release();
    expect(await screen.findByText(/no tiene adeudo/)).toBeInTheDocument();
  });

  it("a refused quote says its real reason (T095, FR-028)", async () => {
    server.use(handlers.quote(() => fail("NOT_CAPABLE", 409)));
    renderApp("/cobro/greyes%40wifiplus");
    expect(await screen.findByText("Por ahora no se puede cobrar a clientes de este negocio.")).toBeInTheDocument();
    expect(screen.queryByText(/Revisa tu conexión/)).toBeNull();
  });

  it("a retry after a lost signal sends the same key, so the payment is never made twice (T093, FR-023, US1/AC13)", async () => {
    const keys: unknown[] = [];
    server.use(
      handlers.quote(() => ok(owes)),
      handlers.record((b) => {
        keys.push((b as { collectionKey: unknown }).collectionKey);
        return keys.length === 1 ? HttpResponse.error() : ok({ id: "pay-1", folio: "DV-7K2Q9M" }, 200);
      }),
      handlers.collection(() => ok(collection())),
    );
    renderApp("/cobro/greyes%40wifiplus");
    await userEvent.click(await screen.findByRole("button", { name: "Cobrar $813.00" }));
    expect(await screen.findByText(/Sin conexión\. Si ya tocaste Cobrar, vuelve a tocarlo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cobrar $813.00" }));
    expect(await screen.findByText("DV-7K2Q9M")).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
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

  it("queued below the threshold: no promise of reconnection, while the registration is on its way (T071)", async () => {
    server.use(
      handlers.collection(() =>
        ok(collection({ class: "short", amountCents: 50000, remainingCents: 29800, outcome: "queued", reconnects: false })),
      ),
    );
    const { container } = renderApp("/cobros/pay-1");
    const badge = await screen.findByText("Sin reactivar");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/el servicio no se reactiva\. Dile al cliente que queda a deber \$298\.00/)).toBeInTheDocument();
    expect(screen.getByText("Registrando el pago en WiFi Plus.")).toBeInTheDocument();
    expect(screen.queryByText("Reconexión en cola")).toBeNull();
    expect(screen.queryByText(/se reactivará/)).toBeNull();
    await expectNoViolations(container);
  });

  it("queued under a register-only rule: the business registers it, and nothing promises the service (T071)", async () => {
    server.use(handlers.collection(() => ok(collection({ outcome: "queued", reconnects: false }))));
    renderApp("/cobros/pay-1");
    expect(await screen.findByText(/El negocio registrará el pago/)).toBeInTheDocument();
    expect(screen.queryByText(/se reactivará/)).toBeNull();
  });

  it("one failed status read keeps the folio on screen and says the update failed (T082, US1/AC10)", async () => {
    let calls = 0;
    server.use(
      handlers.collection(() => {
        calls += 1;
        return calls === 1 ? ok(collection({ outcome: "queued" })) : fail("INTEGRATION_UNAVAILABLE", 503);
      }),
    );
    renderApp("/cobros/pay-1");
    expect(await screen.findByText("DV-7K2Q9M")).toBeInTheDocument();
    expect(await screen.findByText(/No pudimos actualizar el estado/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("DV-7K2Q9M")).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos cargar este pago/)).toBeNull();
  });

  it("asks again every 3 s while queued, and stops once the business answers (T093, D25)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      server.use(
        handlers.collection(() => {
          calls += 1;
          return ok(collection({ outcome: calls < 3 ? "queued" : "reconnected" }));
        }),
      );
      renderApp("/cobros/pay-1");
      expect(await screen.findByText("Reconexión en cola")).toBeInTheDocument();
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1200);
      await waitFor(() => expect(calls).toBe(2));
      await vi.advanceTimersByTimeAsync(3200);
      expect(await screen.findByText("Reconectado")).toBeInTheDocument();
      expect(calls).toBe(3);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the copy button says what it copies (T094)", async () => {
    server.use(handlers.collection(() => ok(collection())));
    renderApp("/cobros/pay-1");
    expect(await screen.findByRole("button", { name: "Copiar comprobante" })).toBeInTheDocument();
  });

  it("*Copiar comprobante* copies the receipt's text and says so (T093)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    server.use(handlers.collection(() => ok(collection())), handlers.receipt(() => ok(receipt())));
    renderApp("/cobros/pay-1");
    await userEvent.click(await screen.findByRole("button", { name: "Copiar comprobante" }));
    expect(await screen.findByText(/Comprobante copiado/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(receipt().text);
  });

  it("*Nuevo cobro* goes back to an empty search (T093)", async () => {
    server.use(handlers.collection(() => ok(collection())));
    renderApp("/cobros/pay-1");
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo cobro" }));
    const box = await screen.findByLabelText("Buscar cliente");
    expect(box).toHaveValue("");
  });

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

describe("cash-at-stores US1 — the frame around the counter (T093)", () => {
  it("a lost signal is said in a banner, and the banner leaves when it returns (D26)", async () => {
    renderApp("/");
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
    expect(screen.queryByText("Sin conexión. Revisa tu internet.")).toBeNull();
    fireEvent(window, new Event("offline"));
    expect(await screen.findByRole("status")).toHaveTextContent("Sin conexión. Revisa tu internet.");
    fireEvent(window, new Event("online"));
    await waitFor(() => expect(screen.queryByText("Sin conexión. Revisa tu internet.")).toBeNull());
  });

  it("the tab of the screen in view is the current page, and only that one", async () => {
    server.use(handlers.cashbox(() => ok(cashbox())));
    renderApp("/");
    const tabs = await screen.findByRole("navigation", { name: "Secciones" });
    expect(within(tabs).getByRole("link", { name: "Cobrar" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Caja" })).not.toHaveAttribute("aria-current");
    await userEvent.click(within(tabs).getByRole("link", { name: "Caja" }));
    await waitFor(() => expect(within(tabs).getByRole("link", { name: "Caja" })).toHaveAttribute("aria-current", "page"));
    expect(within(tabs).getByRole("link", { name: "Cobrar" })).not.toHaveAttribute("aria-current");
    expect(within(tabs).getByRole("link", { name: "Movimientos" })).not.toHaveAttribute("aria-current");
  });
});
