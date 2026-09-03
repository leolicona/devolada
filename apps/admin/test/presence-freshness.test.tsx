import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { linksRosterResponse } from "@devolada/api/direct-payments-schema";
import { paymentRequestsResponse } from "@devolada/api/payment-requests-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";
import { FOCUS_FLOOR_MS, HEARTBEAT_MS, PULSE_MS, resetPresenceForTests } from "../src/lib/presence";

/* docs/polish/presence-freshness.spec.md (US-P07), admin side:
   scenarios 1–6. The button is gone; the signals are the return to the
   tab (D3), the presence heartbeat (D2/D4), Devolada's own pulse (D5),
   and a background failure that keeps the rows (D9). */

const roster = (names: string[]) =>
  linksRosterResponse.parse({
    results: names.map((name, i) => ({
      wisphubId: 100 + i,
      usuario: name.toLowerCase().replace(/\s/g, ""),
      name,
      phone: null,
      url: `https://link.dev.devoladapago.com/p/tok-${i}`,
      waLink: "https://wa.me/?text=hola",
    })),
    complete: true,
    readAt: Date.now(),
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
      linkUrl: null,
      waLink: null,
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

describe("US-P07: no refresh button; the label is the only freshness signal (D1, D9)", () => {
  it("scenario 1: Links and Cobros render 'consultado hace' and no 'Actualizar'", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.linksRoster(() => ok(roster(["Janely Reyes"]))),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.getByText(/consultado hace/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actualizar/i })).not.toBeInTheDocument();
  });
});

describe("US-P07: returning to the tab re-reads, with a 30-second floor (D3)", () => {
  it("scenario 2: 10 s after the last read a return asks nothing; 31 s after, it asks once", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.linksRoster(() => {
        reads++;
        return ok(roster(reads === 1 ? ["Janely Reyes"] : ["Janely Reyes", "Abraham Flores"]));
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(reads).toBe(1);

    vi.advanceTimersByTime(10_000);
    setVisibility("hidden");
    setVisibility("visible");
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(1);
    expect(screen.queryByText("Abraham Flores")).not.toBeInTheDocument();

    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(await screen.findByText("Abraham Flores")).toBeInTheDocument();
    expect(reads).toBe(2);
  });
});

describe("US-P07: the heartbeat runs while someone is present, never while hidden (D2, D4)", () => {
  it("scenario 3: a present tab re-reads after 3 minutes; a hidden one does not", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.linksRoster(() => {
        reads++;
        return ok(roster(reads === 1 ? ["Janely Reyes"] : ["Janely Reyes", "Abraham Flores"]));
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();

    /* Hidden: three minutes pass and nobody asks */
    setVisibility("hidden");
    vi.advanceTimersByTime(HEARTBEAT_MS + 1_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(1);

    /* Visible again, but the return itself is inside no floor here (the
       last read is minutes old) — so the return reads once, and the
       heartbeat reads again three minutes later */
    setVisibility("visible");
    expect(await screen.findByText("Abraham Flores")).toBeInTheDocument();
    const afterReturn = reads;

    vi.advanceTimersByTime(HEARTBEAT_MS + 1_000);
    await vi.waitFor(() => expect(reads).toBe(afterReturn + 1));
  });
});

describe("US-P07: a failed background read keeps what was on screen (D9)", () => {
  it("scenario 4: rows stay, the quiet note shows, no alert and no Reintentar", async () => {
    withClock();
    let reads = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.linksRoster(() => {
        reads++;
        return reads === 1 ? ok(roster(["Janely Reyes"])) : fail("WISPHUB_UNAVAILABLE", 503);
      }),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();

    vi.advanceTimersByTime(FOCUS_FLOOR_MS + 1_000);
    setVisibility("hidden");
    setVisibility("visible");

    expect(await screen.findByRole("status")).toHaveTextContent(/sin conexión a wisphub/i);
    expect(screen.getByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.getByText(/consultado hace/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it("scenario 5: a failure with nothing to show is the error block with Reintentar (list-states D1)", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.linksRoster(() => fail("WISPHUB_UNAVAILABLE", 503)),
    );
    renderApp("/links");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar los links/i);
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
