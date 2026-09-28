import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay } from "msw";
import { paymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { customerDebtResponse, customersResponse } from "@devolada/api/direct-payments-schema";
import { feedResponse } from "@devolada/api/payments-schema";
import { businessActor, fail, handlers, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";
import { FOCUS_FLOOR_MS, resetPresenceForTests } from "../src/lib/presence";
import { resetSeenForTests } from "../src/features/links/seen";
import { DEBT_MAX_IN_FLIGHT, resetDebtGateForTests } from "../src/features/links/useCustomerDebt";

/* cobros-in-links — the Por cobrar view of Links, in the panel.

   US1: the chip beside the search box; the open invoices read one block
   at a time and grouped by customer as they arrive (D6); Venció / Vence
   in the business's timezone; the row's period and saldo anterior; the
   same Copiar and WhatsApp as the customer view.
   US2: the Cobros section is gone, and the view lives in the address.
   US3: a search in Por cobrar finds customers as the customer view does,
   panel rows only, and says what each one owes — or Sin adeudo, or Sin
   confirmar, never a guessed zero.
   US4: the integration away reads as an outage, never as "nobody owes".

   The retired `cobros.test.tsx` cases that still hold live here, each
   citing the case it replaces (D12, D16). Layout — the chip at 360px, a
   block per scroll — is the browser layer's (tests/e2e/links.spec.ts). */

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const invoice = (over: Record<string, unknown> = {}) => ({
  externalId: 42,
  customerUsuario: "greyes@wifiplus",
  customerName: "Janely",
  amountCents: 49900,
  invoiceDate: day(-40),
  dueDate: day(-10),
  periodCents: null,
  carriedCents: null,
  period: null,
  ...over,
});

const block = (rows: unknown[], over: Record<string, unknown> = {}) =>
  paymentRequestsResponse.parse({
    results: rows,
    nextCursor: null,
    total: rows.length,
    integration: "ok",
    ...over,
  });

/* Janely owes two invoices, the older one overdue; Abraham one, not due yet */
const threeInvoices = () => [
  invoice(),
  invoice({ externalId: 57, amountCents: 30000, invoiceDate: day(-9), dueDate: day(+5) }),
  invoice({ externalId: 88, customerUsuario: "aflores@wifiplus", customerName: "Abraham", amountCents: 19900, invoiceDate: day(-3), dueDate: day(+12) }),
];

const panelRow = (over: Record<string, unknown> = {}) => ({
  channel: "panel",
  usuario: "greyes@wifiplus",
  wisphubId: 101,
  customerRef: null,
  label: null,
  askCents: null,
  linkState: null,
  name: "Janely Reyes",
  phone: "5551234567",
  hasLink: false,
  url: null,
  waLink: null,
  ...over,
});

const customersBlock = (rows: unknown[], over: Record<string, unknown> = {}) =>
  customersResponse.parse({ results: rows, nextCursor: null, matched: null, total: rows.length, wisphub: "ok", ...over });

const owes = (usuario: string, totalCents: number) =>
  customerDebtResponse.parse({
    usuario,
    state: "owes",
    totalCents,
    invoiceCents: 0,
    carriedBalanceCents: totalCents,
    invoices: [],
  });
const none = (usuario: string) =>
  customerDebtResponse.parse({ usuario, state: "none", totalCents: 0, invoiceCents: 0, carriedBalanceCents: 0, invoices: [] });
const unconfirmed = (usuario: string) => customerDebtResponse.parse({ usuario, state: "unconfirmed" });

const created = {
  token: "tok-greyes",
  url: "https://link.dev.devoladapago.com/p/tok-greyes",
  waLink: "https://wa.me/525551234567?text=hola",
  created: true,
};

/* happy-dom has no IntersectionObserver. This one reports the sentinel
   in view only when a test says the operator scrolled to it — so a test
   can prove both halves of FR-003: nothing more is read on its own, and
   the next block arrives when asked for. */
const observers: { callback: IntersectionObserverCallback; node: Element | null }[] = [];
class ScrollObserver {
  node: Element | null = null;
  constructor(public callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(node: Element) {
    this.node = node;
  }
  disconnect() {
    const at = observers.indexOf(this);
    if (at >= 0) observers.splice(at, 1);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function scrollToEnd() {
  for (const observer of [...observers]) {
    if (!observer.node?.isConnected) continue;
    observer.callback(
      [{ isIntersecting: true, target: observer.node } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  }
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

beforeEach(() => {
  setVisibility("visible");
  resetPresenceForTests();
  resetSeenForTests();
  resetDebtGateForTests();
  observers.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

type Answer = ReturnType<typeof ok | typeof fail>;

/* The session, the customer view's first block and the Por cobrar
   blocks. Every render of /links asks the customers door for the
   customer view; Por cobrar asks /payment-requests. */
function arrange(
  opts: {
    receivables?: (url: URL) => Answer | Promise<Answer>;
    customers?: (url: URL) => Answer | Promise<Answer>;
    debt?: (url: URL) => Answer | Promise<Answer>;
    actor?: Record<string, unknown>;
    path?: string;
  } = {},
) {
  server.use(
    handlers.session(() => ok({ ...businessActor, ...opts.actor })),
    handlers.customers(opts.customers ?? (() => ok(customersBlock([panelRow({ usuario: "todos1", name: "Cliente de Todos" })], { total: 6522 })))),
    handlers.paymentRequests(opts.receivables ?? (() => ok(block(threeInvoices())))),
    ...(opts.debt ? [handlers.customerDebt(opts.debt)] : []),
  );
  return renderApp(opts.path ?? "/links?view=receivables");
}

/* ---- US1 ---- */

describe("cobros-in-links US1: Por cobrar inside Links", () => {
  it("Links opens on Todos, exactly as today, and reads no open invoice until asked (FR-001)", async () => {
    let receivableReads = 0;
    arrange({
      path: "/links",
      receivables: () => {
        receivableReads++;
        return ok(block(threeInvoices()));
      },
    });
    expect(await screen.findByText("Cliente de Todos")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /todos/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /por cobrar/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText(/6,522 clientes en WispHub/)).toBeInTheDocument();
    expect(receivableReads).toBe(0);
    await expectNoViolations(document.body);
  });

  it("pressing Por cobrar shows the first block, grouped by customer, with the count of open invoices (FR-002, FR-005, FR-007)", async () => {
    const asked: URL[] = [];
    const router = arrange({
      path: "/links",
      receivables: (url) => {
        asked.push(url);
        return ok(block(threeInvoices(), { total: 193 }));
      },
    });
    await screen.findByText("Cliente de Todos");
    await userEvent.click(screen.getByRole("tab", { name: /por cobrar/i }));

    const janely = await screen.findByRole("button", { name: /janely/i });
    expect(within(janely).getByText(/2 facturas/)).toBeInTheDocument();
    expect(within(janely).getByText("$799.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /abraham/i })).toBeInTheDocument();
    /* FR-007: invoices, not customers — two customers, 193 invoices */
    expect(screen.getByText("193 facturas abiertas")).toBeInTheDocument();
    expect(screen.queryByText(/clientes en WispHub/)).not.toBeInTheDocument();
    /* D4: a block sized to the viewport, the first with no cursor */
    expect(asked).toHaveLength(1);
    const limit = Number(asked[0].searchParams.get("limit"));
    expect(limit).toBeGreaterThanOrEqual(10);
    expect(limit).toBeLessThanOrEqual(50);
    expect(asked[0].searchParams.get("cursor")).toBeNull();
    await waitFor(() => expect(router.state.location.search).toEqual({ view: "receivables" }));
    await expectNoViolations(document.body);
  });

  it("D6: a later block's invoice for a customer on screen grows that row and moves it nowhere; nothing is read until the scroll", async () => {
    vi.stubGlobal("IntersectionObserver", ScrollObserver);
    const cursors: (string | null)[] = [];
    arrange({
      receivables: (url) => {
        const cursor = url.searchParams.get("cursor");
        cursors.push(cursor);
        return cursor === null
          ? ok(block([invoice({ dueDate: day(+3) })], { nextCursor: "aW52OjE", total: 3 }))
          : ok(
              block(
                [
                  invoice({ externalId: 88, customerUsuario: "aflores@wifiplus", customerName: "Abraham", amountCents: 19900 }),
                  invoice({ externalId: 57, amountCents: 30000, dueDate: day(+5) }),
                ],
                { total: 3 },
              ),
            );
      },
    });
    const janely = await screen.findByRole("button", { name: /janely/i });
    expect(within(janely).getByText(/1 factura$/)).toBeInTheDocument();
    /* FR-003: not scrolled, nothing more is read */
    await new Promise((r) => setTimeout(r, 50));
    expect(cursors).toEqual([null]);

    scrollToEnd();
    expect(await screen.findByRole("button", { name: /abraham/i })).toBeInTheDocument();
    expect(cursors).toEqual([null, "aW52OjE"]);
    const grown = screen.getByRole("button", { name: /janely/i });
    expect(within(grown).getByText(/2 facturas/)).toBeInTheDocument();
    expect(within(grown).getByText("$799.00")).toBeInTheDocument();
    /* Janely appeared first and stays first */
    const rows = within(screen.getByRole("list", { name: /clientes con facturas abiertas/i })).getAllByRole("button");
    expect(rows[0]).toHaveTextContent(/janely/i);
    expect(rows[1]).toHaveTextContent(/abraham/i);
  });

  it("Venció is judged by the business's timezone, not the browser's (FR-005)", async () => {
    const localToday = new Intl.DateTimeFormat("en-CA").format(new Date());
    const zoneToday = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    /* Pick whichever far zone disagrees with the browser right now: one of
       UTC+14 and UTC-11 always does, the two span 25 hours */
    const ahead = zoneToday("Pacific/Kiritimati") > localToday;
    const timezone = ahead ? "Pacific/Kiritimati" : "Pacific/Pago_Pago";
    /* Ahead: the browser's today is the business's yesterday — overdue.
       Behind: the business's today is the browser's yesterday — not yet. */
    const due = ahead ? localToday : zoneToday("Pacific/Pago_Pago");
    arrange({ actor: { timezone }, receivables: () => ok(block([invoice({ dueDate: due })])) });

    const row = await screen.findByRole("button", { name: /janely/i });
    if (ahead) {
      expect(within(row).getByText(/venció/i)).toBeInTheDocument();
    } else {
      expect(within(row).getByText(/^vence/i)).toBeInTheDocument();
      expect(within(row).queryByText(/venció/i)).not.toBeInTheDocument();
    }
  });

  it("an invoice with no due date shows its issue date and never reads Venció", async () => {
    arrange({ receivables: () => ok(block([invoice({ dueDate: null, invoiceDate: day(-200) })])) });
    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText(/emitida/i)).toBeInTheDocument();
    expect(within(row).queryByText(/venció/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^vence/i)).not.toBeInTheDocument();
  });

  /* Replaces cobros.test.tsx "US-R01 scenario 1" (the expansion) and adds
     FR-006: the period and the part carried from before */
  it("a row opens to its invoices, with the period, the total and the saldo anterior (FR-006)", async () => {
    arrange({
      receivables: () =>
        ok(
          block([
            invoice({
              amountCents: 79800,
              periodCents: 49900,
              carriedCents: 29900,
              period: "Periodo del 15/Sept./2026 al 15/Oct./2026",
            }),
            invoice({ externalId: 57, amountCents: 30000 }),
          ]),
        ),
    });
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    const invoices = await screen.findByRole("list", { name: /facturas de janely/i });
    const lines = within(invoices).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    const measured = lines.find((line) => line.textContent?.includes("Periodo del"))!;
    expect(measured).toHaveTextContent("Periodo del 15/Sept./2026 al 15/Oct./2026");
    expect(within(measured).getByText("$798.00")).toBeInTheDocument();
    expect(measured).toHaveTextContent(/saldo anterior\s*\$299\.00/i);
    /* An invoice with nothing carried says nothing about it */
    const plain = lines.find((line) => line !== measured)!;
    expect(plain).not.toHaveTextContent(/saldo anterior/i);
    await expectNoViolations(document.body);
  });

  /* Replaces cobros.test.tsx "FR-025: Copiar creates the debtor's link
     through the act" (links-on-demand-search US4) */
  it("FR-008: Copiar creates the link through the act, and copies what it returns", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) },
      configurable: true,
    });
    let posted: unknown = null;
    arrange();
    server.use(
      handlers.createLink((body) => {
        posted = body;
        return ok(created);
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    await userEvent.click(await screen.findByRole("button", { name: /copiar link/i }));
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
    expect(posted).toEqual({ usuario: "greyes@wifiplus" });
    expect(copied).toEqual([created.url]);
  });

  /* Replaces cobros.test.tsx "FR-028: WhatsApp opens the debtor's OWN chat" */
  it("FR-008: WhatsApp opens the customer's own chat, with the number the act read", async () => {
    const opened = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
    arrange();
    server.use(handlers.createLink(() => ok(created)));
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    await userEvent.click(await screen.findByRole("button", { name: /whatsapp/i }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => expect(opened.location.href).toBe(created.waLink));
    open.mockRestore();
  });

  /* Replaces cobros.test.tsx "FR-016: a viewer reads the debt and sees neither button" */
  it("a viewer reads the rows and sees no buttons", async () => {
    arrange({ actor: { role: "viewer" } });
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    expect(await screen.findByLabelText(/facturas de janely/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  it("a business with no CLABE sees the rows with the buttons withheld (US1 scenario 7)", async () => {
    arrange({ actor: { speiConfigured: false } });
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    expect(await screen.findByLabelText(/facturas de janely/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  /* Replaces cobros.test.tsx "nobody owes → the honest empty state": the
     words name invoices now, not debt (FR-007) */
  it("a business with no open invoice gets the one empty state, with no warning (US1 scenario 8)", async () => {
    arrange({ receivables: () => ok(block([], { total: 0 })) });
    expect(await screen.findByText("Nadie tiene facturas abiertas hoy.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conexión/i)).not.toBeInTheDocument();
    expect(screen.getByText("0 facturas abiertas")).toBeInTheDocument();
  });

  it("the count says nothing when the integration reports none, and one invoice in the singular (FR-007)", async () => {
    arrange({ receivables: () => ok(block([invoice()], { total: null })) });
    await screen.findByRole("button", { name: /janely/i });
    expect(screen.queryByText(/facturas? abiertas?$/)).not.toBeInTheDocument();

    cleanup();
    arrange({ receivables: () => ok(block([invoice()], { total: 1 })) });
    expect(await screen.findByText("1 factura abierta")).toBeInTheDocument();
  });

  it("returning to the tab re-reads the first block at most once every 30 s, and shows no read age (FR-011)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked: (string | null)[] = [];
    arrange({
      receivables: (url) => {
        asked.push(url.searchParams.get("cursor"));
        return ok(block(asked.length === 1 ? [invoice()] : [invoice(), threeInvoices()[2]]));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    expect(screen.queryByText(/consultado hace/i)).not.toBeInTheDocument();

    /* Inside the floor: a return asks nothing */
    vi.advanceTimersByTime(10_000);
    setVisibility("hidden");
    setVisibility("visible");
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toHaveLength(1);

    /* Past it: one read, of the first block */
    vi.advanceTimersByTime(FOCUS_FLOOR_MS);
    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByRole("button", { name: /abraham/i })).toBeInTheDocument();
    expect(asked).toEqual([null, null]);
    expect(screen.queryByText(/consultado hace/i)).not.toBeInTheDocument();
  });

  it("switching views quickly never draws one view's late answer over the other, and keeps it for the way back", async () => {
    let receivableReads = 0;
    arrange({
      path: "/links",
      receivables: async () => {
        receivableReads++;
        await delay(200);
        return ok(block(threeInvoices()));
      },
    });
    await screen.findByText("Cliente de Todos");
    await userEvent.click(screen.getByRole("tab", { name: /por cobrar/i }));
    await userEvent.click(screen.getByRole("tab", { name: /todos/i }));

    /* The open invoices land while Todos is chosen: Todos stays drawn */
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByText("Cliente de Todos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument();

    /* …and the answer was kept for when they come back: nothing asked again */
    await userEvent.click(screen.getByRole("tab", { name: /por cobrar/i }));
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.queryByText("Cliente de Todos")).not.toBeInTheDocument();
    expect(receivableReads).toBe(1);
  });
});

/* ---- US2 ---- */

describe("cobros-in-links US2: the Cobros section folds into Links", () => {
  it("view=receivables in the address opens Por cobrar", async () => {
    arrange({ path: "/links?view=receivables" });
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /por cobrar/i })).toHaveAttribute("aria-selected", "true");
  });

  it("choosing the chip writes the view into the address and keeps the search text (FR-009)", async () => {
    const router = arrange({
      path: "/links?q=jan",
      customers: (url) =>
        ok(customersBlock([panelRow()], { matched: 1, total: null, ...(url.searchParams.get("q") ? {} : {}) })),
      debt: () => ok(owes("greyes@wifiplus", 29900)),
    });
    await screen.findByText("Janely Reyes");
    await userEvent.click(screen.getByRole("tab", { name: /por cobrar/i }));
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "jan", view: "receivables" }));
    expect(screen.getByLabelText(/buscar cliente/i)).toHaveValue("jan");

    await userEvent.click(screen.getByRole("tab", { name: /todos/i }));
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "jan" }));
  });

  it("an unknown view reads as the customer view", async () => {
    const router = arrange({ path: "/links?view=cobros" });
    expect(await screen.findByText("Cliente de Todos")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /todos/i })).toHaveAttribute("aria-selected", "true");
    expect(router.state.location.search).toEqual({});
  });

  it("the view survives leaving the page and pressing back (US2 scenario 3)", async () => {
    server.use(
      handlers.feed(() =>
        ok(
          feedResponse.parse({
            payments: [],
            nextCursor: null,
            effectiveOverTreatment: "flag",
            today: { count: 0, totalCents: 0, startedAtMs: Date.now() },
          }),
        ),
      ),
    );
    const router = arrange({ path: "/links?view=receivables" });
    await screen.findByRole("button", { name: /janely/i });

    await router.navigate({ to: "/payments" });
    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    router.history.back();
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /por cobrar/i })).toHaveAttribute("aria-selected", "true");
    expect(router.state.location.search).toEqual({ view: "receivables" });
  });

  it("the menu has no Cobros entry, and Links is where it was (FR-014)", async () => {
    arrange();
    await screen.findByRole("button", { name: /janely/i });
    expect(screen.queryByRole("link", { name: "Cobros" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Links" }).length).toBeGreaterThan(0);
  });

  it("the old Cobros address is retired with no redirect, and reads nothing (FR-014, D12)", async () => {
    let receivableReads = 0;
    const router = arrange({
      path: "/payment-requests",
      receivables: () => {
        receivableReads++;
        return ok(block(threeInvoices()));
      },
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(router.state.location.pathname).toBe("/payment-requests");
    expect(screen.queryByRole("heading", { name: "Cobros" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument();
    expect(receivableReads).toBe(0);
  });
});

/* ---- US3 ---- */

describe("cobros-in-links US3: find one debtor from the Por cobrar view", () => {
  const results = () => [
    panelRow(),
    panelRow({ usuario: "aflores@wifiplus", wisphubId: 102, name: "Abraham Flores" }),
    panelRow({ usuario: "mlopez@wifiplus", wisphubId: 103, name: "María López" }),
  ];

  it("three characters search the customers door with channel=panel, and each row says what it owes", async () => {
    const asked: URL[] = [];
    arrange({
      customers: (url) => {
        asked.push(url);
        return ok(customersBlock(results(), { matched: 3, total: null }));
      },
      debt: (url) => {
        const usuario = url.searchParams.get("usuario")!;
        if (usuario === "greyes@wifiplus") return ok(owes(usuario, 29900));
        if (usuario === "aflores@wifiplus") return ok(none(usuario));
        return ok(unconfirmed(usuario));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");

    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    const search = asked.find((url) => url.searchParams.get("q") === "wif")!;
    expect(search.searchParams.get("channel")).toBe("panel");

    const row = (name: string) => screen.getByText(name).closest("li")!;
    await waitFor(() => expect(within(row("Janely Reyes")).getByText("$299.00")).toBeInTheDocument());
    expect(within(row("Janely Reyes")).getByText(/debe/i)).toBeInTheDocument();
    await waitFor(() => expect(within(row("Abraham Flores")).getByText("Sin adeudo")).toBeInTheDocument());
    await waitFor(() => expect(within(row("María López")).getByText("Sin confirmar")).toBeInTheDocument());
    /* Never a zero for someone unconfirmed */
    expect(within(row("María López")).queryByText("$0.00")).not.toBeInTheDocument();
    /* The same count line as the customer view (FR-010) */
    expect(screen.getByText(/3 clientes coinciden con «wif»/)).toBeInTheDocument();
    /* The search replaces the list (FR-010) */
    expect(screen.queryByRole("list", { name: /clientes con facturas abiertas/i })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("each row first says 'Consultando adeudo' inside a Pending — never zero while waiting — and one slow answer holds no other row", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
    arrange({
      customers: () => ok(customersBlock(results().slice(0, 2), { matched: 2, total: null })),
      debt: async (url) => {
        const usuario = url.searchParams.get("usuario")!;
        if (usuario === "greyes@wifiplus") await slow;
        return ok(owes(usuario, usuario === "greyes@wifiplus" ? 29900 : 19900));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");

    const janely = (await screen.findByText("Janely Reyes")).closest("li")!;
    const abraham = screen.getByText("Abraham Flores").closest("li")!;
    /* Abraham's answer lands while Janely's is still out */
    await waitFor(() => expect(within(abraham).getByText("$199.00")).toBeInTheDocument());
    expect(within(janely).getByText("Consultando adeudo")).toBeInTheDocument();
    expect(within(janely).queryByText("$0.00")).not.toBeInTheDocument();

    releaseSlow();
    await waitFor(() => expect(within(janely).getByText("$299.00")).toBeInTheDocument());
    expect(within(janely).queryByText("Consultando adeudo")).not.toBeInTheDocument();
  });

  it(`at most ${DEBT_MAX_IN_FLIGHT} debt requests are in flight at once`, async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      panelRow({ usuario: `cliente${i}@wifiplus`, wisphubId: 200 + i, name: `Cliente ${i}` }),
    );
    let inFlight = 0;
    let peak = 0;
    let answered = 0;
    arrange({
      customers: () => ok(customersBlock(many, { matched: 9, total: null })),
      debt: async (url) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delay(40);
        inFlight--;
        answered++;
        return ok(none(url.searchParams.get("usuario")!));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "cli");
    await screen.findByText("Cliente 0");
    await waitFor(() => expect(answered).toBe(9), { timeout: 4000 });
    expect(peak).toBe(DEBT_MAX_IN_FLIGHT);
    expect(screen.getAllByText("Sin adeudo")).toHaveLength(9);
  });

  it("debt is asked only for the results of loaded blocks: N rows, N requests, none for a block that never loaded (FR-017, SC-009)", async () => {
    vi.stubGlobal("IntersectionObserver", ScrollObserver);
    const debtAsked: string[] = [];
    arrange({
      customers: (url) =>
        url.searchParams.get("cursor") === null
          ? ok(customersBlock(results(), { matched: 40, total: null, nextCursor: "c3E6MTA6MQ" }))
          : ok(customersBlock([panelRow({ usuario: "block2@wifiplus", wisphubId: 300, name: "Del bloque dos" })], { matched: 4, total: null })),
      debt: (url) => {
        debtAsked.push(url.searchParams.get("usuario")!);
        return ok(none(url.searchParams.get("usuario")!));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");
    await screen.findByText("Janely Reyes");
    await waitFor(() => expect(debtAsked).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(debtAsked.sort()).toEqual(["aflores@wifiplus", "greyes@wifiplus", "mlopez@wifiplus"]);

    /* The next block loads only on the scroll, and only then is its row asked */
    scrollToEnd();
    expect(await screen.findByText("Del bloque dos")).toBeInTheDocument();
    await waitFor(() => expect(debtAsked).toHaveLength(4));
    expect(debtAsked).toContain("block2@wifiplus");
  });

  it("a refused key on a debt row switches the page to the Integraciones message", async () => {
    arrange({
      customers: () => ok(customersBlock(results().slice(0, 1), { matched: 1, total: null })),
      debt: () => fail("INTEGRATION_AUTH_FAILED", 503),
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");
    expect(await screen.findByText(/wisphub rechazó la conexión/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ir a integraciones/i })).toHaveAttribute("href", "/integrations/wisphub");
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it("clearing the search brings the list back; under three characters nothing is searched", async () => {
    const searched: string[] = [];
    arrange({
      customers: (url) => {
        const q = url.searchParams.get("q");
        if (q) searched.push(q);
        return ok(customersBlock(results().slice(0, 1), { matched: 1, total: null }));
      },
      debt: (url) => ok(none(url.searchParams.get("usuario")!)),
    });
    await screen.findByRole("button", { name: /janely/i });
    const box = screen.getByLabelText(/buscar cliente/i);

    await userEvent.type(box, "wi");
    expect(await screen.findByText(/escribe al menos 3 letras para buscar/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(searched).toEqual([]);
    /* The list stays while fewer than three are typed */
    expect(screen.getByRole("list", { name: /clientes con facturas abiertas/i })).toBeInTheDocument();

    await userEvent.type(box, "f");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /clientes con facturas abiertas/i })).not.toBeInTheDocument();

    await userEvent.clear(box);
    expect(await screen.findByRole("list", { name: /clientes con facturas abiertas/i })).toBeInTheDocument();
    expect(screen.queryByText("Janely Reyes")).not.toBeInTheDocument();
  });

  it("only the answer for the text as it is now is shown", async () => {
    arrange({
      customers: async (url) => {
        const q = url.searchParams.get("q");
        if (q === "wif") {
          await delay(250);
          return ok(customersBlock([panelRow({ name: "Respuesta vieja" })], { matched: 1, total: null }));
        }
        return ok(customersBlock([panelRow({ usuario: "nuevo@wifiplus", name: "Respuesta nueva" })], { matched: 1, total: null }));
      },
      debt: (url) => ok(none(url.searchParams.get("usuario")!)),
    });
    await screen.findByRole("button", { name: /janely/i });
    const box = screen.getByLabelText(/buscar cliente/i);
    await userEvent.type(box, "wif");
    await new Promise((r) => setTimeout(r, 350));
    await userEvent.type(box, "iplus");
    expect(await screen.findByText("Respuesta nueva")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText("Respuesta vieja")).not.toBeInTheDocument();
  });

  it("the text and the view survive leaving and returning (US3 scenario 9)", async () => {
    const answer = () => ok(customersBlock(results().slice(0, 1), { matched: 1, total: null }));
    const router = arrange({ customers: answer, debt: (url) => ok(owes(url.searchParams.get("usuario")!, 29900)) });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");
    await screen.findByText("Janely Reyes");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "wif", view: "receivables" }));

    cleanup();
    arrange({ path: "/links?q=wif&view=receivables", customers: answer, debt: (url) => ok(owes(url.searchParams.get("usuario")!, 29900)) });
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.getByLabelText(/buscar cliente/i)).toHaveValue("wif");
    expect(screen.getByRole("tab", { name: /por cobrar/i })).toHaveAttribute("aria-selected", "true");
  });

  it("with the customers door answering from its offline fallback, every result reads Sin confirmar and nothing is asked (FR-010)", async () => {
    let debtAsked = 0;
    arrange({
      customers: () =>
        ok(customersBlock([panelRow({ name: null, phone: null, hasLink: true, url: "https://x/p/t", waLink: "https://wa.me/?text=x" })], {
          matched: 1,
          total: null,
          wisphub: "unavailable",
        })),
      debt: () => {
        debtAsked++;
        return ok(none("greyes@wifiplus"));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "gre");
    expect(await screen.findByText("Sin confirmar")).toBeInTheDocument();
    expect(screen.getByText(/sin conexión a wisphub/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(debtAsked).toBe(0);
  });

  it("without the customerDebt capability, the search finds customers and shows no debt", async () => {
    let debtAsked = 0;
    arrange({
      actor: { integrationCapabilities: ["receivables"] },
      customers: () => ok(customersBlock(results().slice(0, 1), { matched: 1, total: null })),
      debt: () => {
        debtAsked++;
        return ok(none("greyes@wifiplus"));
      },
    });
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.type(screen.getByLabelText(/buscar cliente/i), "wif");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(debtAsked).toBe(0);
    expect(screen.queryByText("Consultando adeudo")).not.toBeInTheDocument();
  });
});

/* ---- US4 ---- */

describe("cobros-in-links US4: the integration away is never read as 'nobody owes'", () => {
  it("unavailable with no rows: the could-not-read state with Reintentar, never 'Nadie tiene facturas abiertas'", async () => {
    let reads = 0;
    arrange({
      receivables: () => {
        reads++;
        return reads === 1
          ? ok(block([], { total: null, integration: "unavailable" }))
          : ok(block(threeInvoices()));
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar tus facturas abiertas/i);
    expect(screen.queryByText(/nadie tiene facturas abiertas/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it("unavailable on a later block keeps the rows under 'Sin conexión a WispHub'", async () => {
    vi.stubGlobal("IntersectionObserver", ScrollObserver);
    arrange({
      receivables: (url) =>
        url.searchParams.get("cursor") === null
          ? ok(block([invoice()], { nextCursor: "aW52OjE", total: 30 }))
          : ok(block([], { total: null, integration: "unavailable" })),
    });
    await screen.findByRole("button", { name: /janely/i });
    scrollToEnd();
    expect(await screen.findByText(/sin conexión a wisphub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/nadie tiene facturas abiertas/i)).not.toBeInTheDocument();
  });

  /* Replaces cobros.test.tsx "bug cobros-installation-fallback:
     WISPHUB_AUTH_FAILED → the Integraciones door" — the core's code now */
  it("bug cobros-installation-fallback: a refused key shows the Integraciones message and no Reintentar", async () => {
    arrange({ receivables: () => fail("INTEGRATION_AUTH_FAILED", 503) });
    const sentence = await screen.findByText(/wisphub rechazó la conexión/i);
    const notice = sentence.closest('[role="status"]') as HTMLElement;
    expect(notice).toHaveTextContent(/revisa primero la instalación y luego la llave/i);
    expect(within(notice).getByRole("link", { name: /ir a integraciones/i })).toHaveAttribute("href", "/integrations/wisphub");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nadie tiene facturas abiertas/i)).not.toBeInTheDocument();
  });

  /* Replaces cobros.test.tsx "a background read that starts being
     refused replaces the rows with the door" */
  it("bug cobros-installation-fallback: a background re-read that starts being refused replaces the rows with the door", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    arrange({
      receivables: () => {
        reads++;
        return reads === 1 ? ok(block(threeInvoices())) : fail("INTEGRATION_AUTH_FAILED", 503);
      },
    });
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByText(/wisphub rechazó la conexión/i)).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conexión a wisphub/i)).not.toBeInTheDocument();
  });

  it("a session without the receivables capability shows no chip, and the page is the customer view (FR-013)", async () => {
    let receivableReads = 0;
    const router = arrange({
      path: "/links?view=receivables",
      actor: { integrationCapabilities: [] },
      receivables: () => {
        receivableReads++;
        return ok(block(threeInvoices()));
      },
    });
    expect(await screen.findByText("Cliente de Todos")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(receivableReads).toBe(0);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await expectNoViolations(document.body);
  });

  it("view=receivables answered by a 409 falls back to the customer view (D13)", async () => {
    const router = arrange({ receivables: () => fail("NOT_CONFIGURED", 409) });
    expect(await screen.findByText("Cliente de Todos")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.getByRole("tab", { name: /todos/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
