import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US4 (FR-031, FR-032, FR-030; research D23): cash
   payments join Pagos beside the SPEI ones, marked "Efectivo · <tienda>"
   in icon and text; a channel filter asks the API for one or both; the
   opened row names the store, the fee the payer paid at the counter and
   every correction the operator wrote. Fixtures parse with the contract
   (constitution III). */

const at = Date.UTC(2026, 9, 1, 17, 0);
const base = {
  status: "confirmed",
  actionOutcome: "done",
  reconciliationClass: "exact",
  invoiceCents: 39900,
  carriedBalanceCents: 0,
  missingCents: 0,
  surplusCents: 0,
  observedAction: null,
  dispatchedAction: "register_and_reconnect",
  createdAt: at,
  actionDoneAt: at,
  actionAttempts: 1,
  actionError: null,
};
const spei = {
  ...base,
  id: "p-spei",
  folio: "DV-SPEI01",
  channel: "spei",
  receivedCents: 41400,
  serviceFeeCents: 1500,
  askedCents: 41400,
  customerName: "Janely Ruiz",
  storeName: null,
};
const cash = {
  ...base,
  id: "p-cash",
  folio: "DV-CASH01",
  channel: "store",
  /* data-model: a cash row asks the debt, with no business fee */
  receivedCents: 39900,
  serviceFeeCents: 0,
  askedCents: 39900,
  customerName: "Mario Pérez",
  storeName: "Abarrotes Lupita",
  storeFeeCents: 1500,
  corrections: [{ cents: -5000, reason: "Se capturó $50 de más", author: "operador@devolada.app", at: at + 60_000 }],
};

const feedOf = (rows: unknown[]) =>
  feedResponse.parse({
    payments: rows,
    nextCursor: null,
    effectiveOverTreatment: "flag",
    today: { count: rows.length, totalCents: 81300, startedAtMs: Date.UTC(2026, 9, 1, 6) },
  });

/* A business that has had cash at stores (D7): the filter is offered */
const withStores = { ...businessActor, storeChannel: { on: true, since: at - 86_400_000 } };

function arrange(actor: object = withStores) {
  const asked: URL[] = [];
  server.use(
    handlers.session(() => ok(actor)),
    handlers.feed((url) => {
      if (url.searchParams.get("action") === "failed") return ok(feedOf([]));
      asked.push(url);
      const channel = url.searchParams.get("channel");
      return ok(feedOf(channel === "store" ? [cash] : channel === "spei" ? [spei] : [cash, spei]));
    }),
  );
  renderApp("/payments");
  return asked;
}

describe("cash-at-stores US4: cash payments in Pagos", () => {
  it("lists a cash row beside the SPEI one, marked Efectivo · <tienda> with an icon", async () => {
    arrange();
    const row = await screen.findByRole("button", { name: /mario pérez/i });
    const line = within(row).getByText(/Efectivo · Abarrotes Lupita/);
    /* status is never colour alone: the store icon rides with the words */
    expect(line.querySelector("svg")).not.toBeNull();
    const other = screen.getByRole("button", { name: /janely ruiz/i });
    expect(within(other).getByText(/Pago directo · SPEI/)).toBeInTheDocument();
    expect(within(row).getByText("Reconectado")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the channel filter asks for cash, SPEI, or both", async () => {
    const asked = arrange();
    await screen.findByRole("button", { name: /mario pérez/i });
    const group = screen.getByRole("group", { name: "Canal" });
    expect(within(group).getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
    expect(asked.at(-1)!.searchParams.has("channel")).toBe(false);

    await userEvent.click(within(group).getByRole("button", { name: /efectivo/i }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get("channel")).toBe("store"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /janely ruiz/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /mario pérez/i })).toBeInTheDocument();

    await userEvent.click(within(group).getByRole("button", { name: "SPEI" }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get("channel")).toBe("spei"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /mario pérez/i })).not.toBeInTheDocument());

    await userEvent.click(within(group).getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.has("channel")).toBe(false));
    await expectNoViolations(document.body);
  });

  it("a business that never had cash at stores sees no channel filter (D23)", async () => {
    arrange(businessActor);
    await screen.findByRole("button", { name: /mario pérez/i });
    expect(screen.queryByRole("group", { name: "Canal" })).not.toBeInTheDocument();
  });

  it("the opened cash row names the store, the counter's fee and every correction — and offers no proof", async () => {
    arrange();
    await userEvent.click(await screen.findByRole("button", { name: /mario pérez/i }));
    expect(await screen.findByText("Folio DV-CASH01")).toBeInTheDocument();

    const detail = screen.getByText("Folio DV-CASH01").closest("div")!;
    expect(within(detail).getByText("Tienda").nextElementSibling).toHaveTextContent("Abarrotes Lupita");
    expect(within(detail).getByText("Cargo por servicio en tienda").nextElementSibling).toHaveTextContent("$15.00");
    expect(within(detail).getByText(/aparte de su adeudo/)).toBeInTheDocument();
    /* the business fee line belongs to SPEI rows: a cash payer paid none */
    expect(screen.queryByText("Cargo por servicio")).not.toBeInTheDocument();

    expect(within(detail).getByText("Correcciones")).toBeInTheDocument();
    expect(within(detail).getByText(/Se capturó \$50 de más/)).toBeInTheDocument();
    expect(within(detail).getByText(/operador@devolada\.app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comprobante/i })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a cash row's action error speaks the core's words (D9)", async () => {
    server.use(
      handlers.session(() => ok(withStores)),
      handlers.feed(() =>
        ok(feedOf([{ ...cash, actionOutcome: "failed", actionDoneAt: null, actionError: "INTEGRATION_UNAVAILABLE" }])),
      ),
    );
    renderApp("/payments");
    await userEvent.click(await screen.findByRole("button", { name: /mario pérez/i }));
    expect(await screen.findByText("Tu sistema no respondió. Lo seguimos intentando.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar reconexión" })).toBeInTheDocument();
  });
});
