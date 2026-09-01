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
      reconnectionStatus: "reconnected",
      reconciliationClass: "exact",
      receivedCents: 41400,
      invoiceCents: 39900,
      carriedBalanceCents: 0,
      serviceFeeCents: 1500,
      askedCents: 41400,
      missingCents: 0,
      surplusCents: 0,
      customerName: "Janely",
      storeName: "Abarrotes La Esquina",
      createdAt: Date.UTC(2026, 7, 14, 20, 30),
      reconnectedAt: Date.UTC(2026, 7, 14, 20, 31),
      attempts: 1,
      lastError: null,
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
