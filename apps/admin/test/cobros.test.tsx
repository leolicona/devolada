import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { paymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { fail, handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { FOCUS_FLOOR_MS, resetPresenceForTests } from "../src/lib/presence";

/* docs/legacy/reconciliation/cobros-live.spec.md — the section (US-R01):
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
        linkUrl: null,
        waLink: null,
      },
      {
        externalId: 57,
        customerUsuario: "greyes@wifiplus",
        customerName: "Janely",
        amountCents: 30000,
        invoiceDate: day(-9),
        dueDate: day(+5),
        linkUrl: null,
        waLink: null,
      },
      /* Abraham's single invoice is not due yet */
      {
        externalId: 88,
        customerUsuario: "aflores@wifiplus",
        customerName: "Abraham",
        amountCents: 19900,
        invoiceDate: day(-3),
        dueDate: day(+12),
        linkUrl: null,
        waLink: null,
      },
    ],
    complete: true,
    readAt: Date.now(),
    ...over,
  });

/* presence-freshness D5: the section also polls the pulse; quiet here */
const pulse = () => handlers.paymentsPulse(() => ok({ registeredAt: null }));

const arrange = (response: () => ReturnType<typeof ok | typeof fail>) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.paymentRequests(response), pulse());
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
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar tus cobros en wisphub/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    /* never an empty claim on a failure (US-P01) */
    expect(screen.queryByText(/nadie te debe hoy/i)).not.toBeInTheDocument();
  });

  it("scenario 9: without a WispHub key the section says how to connect, and the door is Integraciones", async () => {
    arrange(() => fail("NOT_CONFIGURED", 409));
    expect(await screen.findByText(/conecta wisphub para ver tus cobros/i)).toBeInTheDocument();
    /* bug cobros-installation-fallback: the key lives in the hub, not in
       Configuración, since integrations-hub D1 */
    expect(screen.getByRole("link", { name: /ir a integraciones/i })).toHaveAttribute(
      "href",
      "/integrations/wisphub",
    );
  });

  it("nobody owes → the honest empty state", async () => {
    arrange(() => ok(paymentRequestsResponse.parse({ cobros: [], complete: true, readAt: Date.now() })));
    expect(await screen.findByText(/nadie te debe hoy/i)).toBeInTheDocument();
  });
});

/* bug: cobros-installation-fallback — the pilot's key was refused by the
   installation the platform fell back to, and the screen called it an
   outage with a Reintentar that re-sent the same key to the same place.
   A refused key is setup, not weather: it gets the Integraciones door,
   and the address is named before the credential (provider-address-per-isp
   D7), because the key was fine. */
describe("bug cobros-installation-fallback: a refused key is a setup problem, not an outage", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  }
  beforeEach(() => {
    setVisibility("visible");
    resetPresenceForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("WISPHUB_AUTH_FAILED → the Integraciones door, the installation named first, and no Reintentar", async () => {
    arrange(() => fail("WISPHUB_AUTH_FAILED", 503));
    const sentence = await screen.findByText(/wisphub rechazó la conexión/i);
    /* A warning, announced politely — not the assertive alert an outage is */
    const notice = sentence.closest('[role="status"]') as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent(/revisa primero la instalación y luego la llave/i);
    expect(within(notice).getByRole("link", { name: /ir a integraciones/i })).toHaveAttribute(
      "href",
      "/integrations/wisphub",
    );
    /* Neither the outage recipe nor an empty claim (US-P01) */
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no pudimos cargar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nadie te debe hoy/i)).not.toBeInTheDocument();
  });

  it("a background read that starts being refused replaces the rows with the door, not the 'sin conexión' note", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.paymentRequests(() => {
        reads++;
        return reads === 1 ? ok(cobros()) : fail("WISPHUB_AUTH_FAILED", 503);
      }),
      pulse(),
    );
    renderApp("/payment-requests");
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();

    /* presence-freshness D3: the return to the tab past the floor re-reads */
    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");

    expect(await screen.findByText(/wisphub rechazó la conexión/i)).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conexión a wisphub/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it("WISPHUB_UNAVAILABLE keeps the outage recipe: Reintentar, no door", async () => {
    arrange(() => fail("WISPHUB_UNAVAILABLE", 503));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar tus cobros en wisphub/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ir a integraciones/i })).not.toBeInTheDocument();
  });
});
/* pilot-UX round: the debtor's link lives one expansion away. */
describe("pilot-UX: Copiar link y WhatsApp por deudor", () => {
  const withLink = (over: Record<string, unknown> = {}) =>
    paymentRequestsResponse.parse({
      cobros: [
        {
          externalId: 42,
          customerUsuario: "greyes@wifiplus",
          customerName: "Janely",
          amountCents: 49900,
          invoiceDate: day(-5),
          dueDate: day(5),
          linkUrl: "https://link.dev.devoladapago.com/p/tokrowlink",
          waLink: "https://wa.me/?text=hola",
        },
      ],
      complete: true,
      readAt: Date.now(),
      ...over,
    });

  it("an operator sees both actions in the expansion and copy answers", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
    arrange(() => ok(withLink()));

    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    await userEvent.click(await screen.findByRole("button", { name: /copiar link/i }));
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /whatsapp/i })).toBeInTheDocument();
  });

  it("a viewer reads the debt and sees no buttons", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "viewer" })),
      handlers.paymentRequests(() => ok(withLink())),
      pulse(),
    );
    renderApp("/payment-requests");

    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    expect(await screen.findByLabelText(/facturas de janely/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar link/i })).not.toBeInTheDocument();
  });
});
