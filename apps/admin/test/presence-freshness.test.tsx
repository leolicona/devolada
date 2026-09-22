import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { customersResponse } from "@devolada/api/direct-payments-schema";
import { paymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";
import { FOCUS_FLOOR_MS, HEARTBEAT_MS, PULSE_MS, resetPresenceForTests } from "../src/lib/presence";

/* docs/legacy/polish/presence-freshness.spec.md (US-P07), admin side:
   scenarios 1–6. The button is gone; the signals are the return to the
   tab (D3), the presence heartbeat on Cobros (D2/D4), Devolada's own pulse (D5),
   and a background failure that keeps the rows (D9). */

/* links-on-demand-search US1: the roster became one block of customers,
   read live when it renders (FR-001). Most of them have no link yet. */
const customers = (names: string[]) =>
  customersResponse.parse({
    results: names.map((name, i) => ({
      channel: "panel",
      usuario: name.toLowerCase().replace(/\s/g, ""),
      wisphubId: 100 + i,
      customerRef: null,
      label: null,
      askCents: null,
      linkState: null,
      name,
      phone: null,
      hasLink: false,
      url: null,
      waLink: null,
    })),
    nextCursor: null,
    matched: null,
    total: names.length,
    wisphub: "ok",
  });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const cobros = (names: string[]) =>
  paymentRequestsResponse.parse({
    cobros: names.map((name, i) => ({
      externalId: 40 + i,
      customerUsuario: `${name.toLowerCase()}@wifiplus`,
      customerName: name,
      amountCents: 49900,
      invoiceDate: day(-9),
      dueDate: day(+5),
    })),
    complete: true,
    readAt: Date.now(),
  });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  /* TanStack's focusManager listens on window; the presence store on
     document — one bubbling event reaches both */
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

/* The clock the floor and the heartbeat read. `shouldAdvanceTime` keeps
   testing-library's own polling alive while the test jumps forward. */
const withClock = () => vi.useFakeTimers({ shouldAdvanceTime: true });

/* links-on-demand-search FR-027 / D15 amends this scenario for Links.
   The page used to serve a cache — 30 seconds, then a snapshot minutes
   old — so the operator had to be told how old the list was. A block is
   read when it RENDERS, so there is no shared age to report and nothing
   to refresh by hand: the indicator goes, and "no Actualizar" stays.
   Cobros keeps both, and its own scenario below proves it. */
describe("US-P07 amended by links-on-demand-search D15: Links reports no age, and still has no button", () => {
  it("scenario 1: the rows carry no 'consultado hace' and the page carries no 'Actualizar'", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => ok(customers(["Janely Reyes"]))),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByText(/consultado hace/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actualizar/i })).not.toBeInTheDocument();
  });
});

describe("US-P07: returning to the tab re-reads, with a 30-second floor (D3)", () => {
  it("scenario 2: 10 s after the last read a return asks nothing; 31 s after, it asks once", async () => {
    withClock();
    const asked: URL[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers((url) => {
        asked.push(url);
        return ok(customers(asked.length === 1 ? ["Janely Reyes"] : ["Janely Reyes", "Abraham Flores"]));
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(asked).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    setVisibility("hidden");
    setVisibility("visible");
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toHaveLength(1);
    expect(screen.queryByText("Abraham Flores")).not.toBeInTheDocument();

    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByText("Abraham Flores")).toBeInTheDocument();
    expect(asked).toHaveLength(2);
    /* links-on-demand-search D15: the FIRST block only. A screen left
       open overnight must not show yesterday's first page; re-reading
       every block someone scrolled through is provider calls nobody
       asked for. */
    expect(asked[1].searchParams.get("cursor")).toBeNull();
  });
});

describe("US-P07: the heartbeat runs while someone is present, never while hidden (D2, D4)", () => {
  it("scenario 3: a present Cobros tab re-reads after 3 minutes; a hidden one does not", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.paymentsPulse(() => ok({ registeredAt: null })),
      handlers.paymentRequests(() => {
        reads++;
        return ok(cobros(reads === 1 ? ["Janely"] : ["Janely", "Abraham"]));
      }),
    );
    renderApp("/payment-requests");
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();

    /* Hidden: three minutes pass and nobody asks */
    setVisibility("hidden");
    vi.advanceTimersByTime(HEARTBEAT_MS + 1_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(1);

    /* Visible again, but the return itself is inside no floor here (the
       last read is minutes old) — so the return reads once, and the
       heartbeat reads again three minutes later */
    setVisibility("visible");
    expect(await screen.findByRole("button", { name: /abraham/i })).toBeInTheDocument();
    const afterReturn = reads;

    vi.advanceTimersByTime(HEARTBEAT_MS + 1_000);
    await vi.waitFor(() => expect(reads).toBe(afterReturn + 1));
  });

  it("scenario 3b: Links carries no heartbeat — three present minutes ask nothing, the return to the tab still does (D4 amended)", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => {
        reads++;
        return ok(customers(reads === 1 ? ["Janely Reyes"] : ["Janely Reyes", "Abraham Flores"]));
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();

    vi.advanceTimersByTime(HEARTBEAT_MS + 1_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(1);
    expect(screen.queryByText("Abraham Flores")).not.toBeInTheDocument();

    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByText("Abraham Flores")).toBeInTheDocument();
    expect(reads).toBe(2);
  });
});

describe("US-P07: a failed background read keeps what was on screen (D9)", () => {
  it("scenario 4: rows stay, the quiet note shows, no alert and no Reintentar", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => {
        reads++;
        return reads === 1 ? ok(customers(["Janely Reyes"])) : fail("WISPHUB_UNAVAILABLE", 503);
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();

    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");

    expect(await screen.findByRole("status")).toHaveTextContent(/sin conexión a wisphub/i);
    expect(screen.getByText("Janely Reyes")).toBeInTheDocument();
    /* links-on-demand-search FR-027: no age beside the rows any more —
       the note is the only staleness this page ever admits */
    expect(screen.queryByText(/consultado hace/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it("scenario 5: a failure with nothing to show is the error block with Reintentar (list-states D1)", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.customers(() => fail("WISPHUB_UNAVAILABLE", 503)),
    );
    renderApp("/links");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar tus clientes/i);
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});

describe("US-P07: Cobros listens to Devolada's own pulse (D5)", () => {
  it("scenario 6: when a payment gets registered, the section re-reads without any interaction", async () => {
    withClock();
    let pulses = 0;
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.paymentsPulse(() => {
        pulses++;
        return ok({ registeredAt: pulses === 1 ? null : 1_756_900_000_000 });
      }),
      handlers.paymentRequests(() => {
        reads++;
        return ok(cobros(reads === 1 ? ["Janely", "Abraham"] : ["Abraham"]));
      }),
    );
    renderApp("/payment-requests");
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(reads).toBe(1);

    /* The pulse ticks; its value moved (Janely's payment reached WispHub) */
    vi.advanceTimersByTime(PULSE_MS + 1_000);
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /janely/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /abraham/i })).toBeInTheDocument();
    expect(reads).toBe(2);
    expect(screen.queryByRole("button", { name: /actualizar/i })).not.toBeInTheDocument();
  });
});
