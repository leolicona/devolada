import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { fail, handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/polish/list-states.spec.md scenarios 1–2. */

const emptyFeed = feedResponse.parse({
  payments: [],
  nextCursor: null,
  effectiveOverTreatment: "flag",
  today: { count: 0, totalCents: 0, startedAtMs: Date.UTC(2026, 7, 14, 6) },
});

const oneCharge = feedResponse.parse({
  payments: [
    {
      id: "ch-1",
      folio: "DV-FEED01",
      channel: "spei",
      status: "confirmed",
      actionOutcome: "done",
      reconciliationClass: "exact",
      receivedCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      askedCents: 41400,
      missingCents: 0,
      surplusCents: 0,
      observedAction: null,
      dispatchedAction: null,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: Date.UTC(2026, 7, 14, 20, 30),
      actionDoneAt: Date.UTC(2026, 7, 14, 20, 31),
      actionAttempts: 1,
      actionError: null,
    },
  ],
  nextCursor: null,
  effectiveOverTreatment: "flag",
  today: { count: 1, totalCents: 41400, startedAtMs: Date.UTC(2026, 7, 14, 6) },
});

describe("US-P01: a failed list says so instead of claiming it is empty", () => {
  it("shows the error and never the empty sentence", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => fail("INTERNAL_SERVER_ERROR", 500)),
    );
    renderApp("/");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos cargar los pagos/i);
    /* The lie this spec exists to remove */
    expect(screen.queryByText(/sin pagos por aquí/i)).not.toBeInTheDocument();
  });

  it("keeps the empty sentence when the list really is empty", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => ok(emptyFeed)),
    );
    renderApp("/");

    expect(await screen.findByText(/sin pagos por aquí/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("US-P01: retrying loads the data without leaving the screen", () => {
  it("refetches on tap and shows the rows", async () => {
    let failNext = true;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => {
        if (failNext) {
          failNext = false;
          return fail("INTERNAL_SERVER_ERROR", 500);
        }
        return ok(oneCharge);
      }),
    );
    const router = renderApp("/");

    await userEvent.click(await screen.findByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText("Janely")).toBeInTheDocument();
    /* The failed-charges strip is also role="alert", so name the message */
    expect(screen.queryByText(/no pudimos cargar/i)).not.toBeInTheDocument();
    /* D2: a retry is a refetch, not a navigation */
    expect(router.state.location.pathname).toBe("/payments");
  });

});

/* 2026-09-03, ui-refactor: D3 said the recipe would be repeated seven
   times, and it was — every SaaS-era read screen hand-rolled its own
   underlined "Reintentar" instead of the atom. These are the five that
   had the state but no test, so the drift could come back unnoticed. */
describe("US-P01: every admin read screen fails through the same atom", () => {
  const screens = [
    { name: "Saldo y recargas", path: "/settings/credit", what: /no pudimos cargar tu saldo/i, down: () => handlers.credit(() => fail("INTERNAL_SERVER_ERROR", 500)) },
    { name: "Usuarios", path: "/settings/users", what: /no pudimos cargar los usuarios/i, down: () => handlers.members(() => fail("INTERNAL_SERVER_ERROR", 500)) },
    { name: "Integraciones", path: "/integrations", what: /no pudimos cargar tus integraciones/i, down: () => handlers.integrations(() => fail("INTERNAL_SERVER_ERROR", 500)) },
    { name: "WispHub", path: "/integrations/wisphub", what: /no pudimos cargar la integración/i, down: () => handlers.integrations(() => fail("INTERNAL_SERVER_ERROR", 500)) },
  ];

  for (const s of screens) {
    it(`${s.name}: the failure names the list and offers one real retry button`, async () => {
      server.use(
        handlers.session(() => ok(businessActor)),
        handlers.creditEntries(() => ok({ entries: [], nextCursor: null })),
        handlers.topUps(() => ok({ topUps: [] })),
        s.down(),
      );
      renderApp(s.path);

      /* D1: an error is announced, never dressed as an empty state */
      const alert = await screen.findByText(s.what);
      expect(alert).toBeInTheDocument();
      /* D3: the atom's button, not an underlined <button> in a sentence */
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    });
  }

  it("Saldo: tapping Reintentar refetches without leaving the screen (D2)", async () => {
    let failNext = true;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.creditEntries(() => ok({ entries: [], nextCursor: null })),
      handlers.topUps(() => ok({ topUps: [] })),
      handlers.credit(() => {
        if (failNext) {
          failNext = false;
          return fail("INTERNAL_SERVER_ERROR", 500);
        }
        return ok({
          balanceCents: 10000,
          feeCents: 500,
          capCents: 5000,
          minTopUpCents: 5000,
          step: "ok",
          topUp: { clabe: "646180157099999999", bank: "STP", beneficiary: "Devolada" },
        });
      }),
    );
    const router = renderApp("/settings/credit");

    await userEvent.click(await screen.findByRole("button", { name: /reintentar/i }));

    expect(await screen.findByText(/cada validación cuesta/i)).toBeInTheDocument();
    expect(screen.queryByText(/no pudimos cargar tu saldo/i)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/credit");
  });
});
