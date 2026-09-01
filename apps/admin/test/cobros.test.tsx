import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { fail, handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/reconciliation/cobros-live.spec.md — the section (US-R01):
   grouped by customer, local search and filters, freshness, and the
   states a live read owes (error, not-configured, incomplete, empty). */

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const cobros = (over: Partial<{ complete: boolean }> = {}) =>
  paymentRequestsResponse.parse({
    cobros: [
      /* Janely owes two invoices, the older one overdue */
      {
        externalId: 42,
        customerUsuario: "greyes@wifiplus",
        customerName: "Janely",
        amountCents: 49900,
        invoiceDate: day(-40),
        dueDate: day(-10),
      },
      {
        externalId: 57,
        customerUsuario: "greyes@wifiplus",
        customerName: "Janely",
        amountCents: 30000,
        invoiceDate: day(-9),
        dueDate: day(+5),
      },
      /* Abraham's single invoice is not due yet */
      {
        externalId: 88,
        customerUsuario: "aflores@wifiplus",
        customerName: "Abraham",
        amountCents: 19900,
        invoiceDate: day(-3),
        dueDate: day(+12),
      },
    ],
    complete: true,
    readAt: Date.now(),
    ...over,
  });

const arrange = (response: () => ReturnType<typeof ok | typeof fail>) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.paymentRequests(response));
  return renderApp("/payment-requests");
};

describe("US-R01: who owes what, grouped by customer, oldest debt first", () => {
  it("scenario 1: one row per customer with count and total; expanding lists the invoices", async () => {
    arrange(() => ok(cobros()));

    const janely = await screen.findByRole("button", { name: /janely/i });
    expect(within(janely).getByText(/2 facturas/)).toBeInTheDocument();
    expect(within(janely).getByText("$799.00")).toBeInTheDocument();
    /* Overdue is icon + word, never color alone */
    expect(within(janely).getByText(/venció/i)).toBeInTheDocument();

    /* The oldest debt sorts first (D4) */
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/janely/i);

    await userEvent.click(janely);
    const invoices = await screen.findByRole("list", { name: /facturas de janely/i });
    expect(within(invoices).getAllByRole("listitem")).toHaveLength(2);
    expect(within(invoices).getByText("$499.00")).toBeInTheDocument();

    /* D3: the screen says when it asked */
    expect(screen.getByText(/consultado hace/i)).toBeInTheDocument();
  });

  it("scenario 5: search narrows by name or usuario; Vencidas keeps only overdue customers", async () => {
    arrange(() => ok(cobros()));
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.type(screen.getByLabelText(/buscar por nombre o usuario/i), "aflores");
    expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abraham/i })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/buscar por nombre o usuario/i));
    await userEvent.click(screen.getByRole("tab", { name: "Vencidas" }));
    expect(screen.getByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /abraham/i })).not.toBeInTheDocument();
  });

  it("scenario 6: a cut-off read warns, never a silent truncation", async () => {
    arrange(() => ok(cobros({ complete: false })));
    expect(await screen.findByText(/la lista puede estar incompleta/i)).toBeInTheDocument();
  });

  it("scenario 7: WispHub down → the section says so, with Reintentar", async () => {
    arrange(() => fail("WISPHUB_UNAVAILABLE", 503));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos consultar tus cobros/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    /* never an empty claim on a failure (US-P01) */
    expect(screen.queryByText(/nadie te debe hoy/i)).not.toBeInTheDocument();
  });

  it("scenario 9: without a WispHub key the section says how to connect", async () => {
    arrange(() => fail("NOT_CONFIGURED", 409));
    expect(await screen.findByText(/conecta wisphub para ver tus cobros/i)).toBeInTheDocument();
  });

  it("nobody owes → the honest empty state", async () => {
    arrange(() => ok(paymentRequestsResponse.parse({ cobros: [], complete: true, readAt: Date.now() })));
    expect(await screen.findByText(/nadie te debe hoy/i)).toBeInTheDocument();
  });
});
