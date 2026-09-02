import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/charge-feed.spec.md scenarios 4–6. */

const charge = (over: Partial<Parameters<typeof Object.assign>[1]> = {}) => ({
  id: "ch-1",
  folio: "DV-FEED01",
  channel: "spei" as const,
  status: "confirmed" as const,
  reconnectionStatus: "reconnected" as const,
  reconciliationClass: "exact" as const,
  receivedCents: 41400,
  invoiceCents: 39900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
  askedCents: 41400,
  missingCents: 0,
  surplusCents: 0,
  customerName: "Janely",
  storeName: null,
  createdAt: Date.now(),
  reconnectedAt: Date.now(),
  attempts: 1,
  lastError: null,
  ...over,
});

function feedOf(
  rows: unknown[],
  today = { count: 2, totalCents: 82800, startedAtMs: Date.UTC(2026, 7, 14, 6) },
  effectiveOverTreatment: "flag" | "credit" = "flag",
) {
  return feedResponse.parse({ payments: rows, nextCursor: null, effectiveOverTreatment, today });
}

describe("US-A01: the feed shows rows and expands into detail", () => {
  it("renders customer, channel, badge and amount; expanding shows folio and breakdown", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [charge()])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText(/Pago directo · SPEI/)).toBeInTheDocument();
    expect(within(row).getByText("Reconectado")).toBeInTheDocument();
    expect(screen.getByText(/hoy:/i)).toHaveTextContent("$828.00");

    await userEvent.click(row);
    expect(await screen.findByText("Folio DV-FEED01")).toBeInTheDocument();
    expect(screen.getByText("Cargo del periodo")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
  });

  /* design-review D9: charge-feed asked for the feed to announce, and the
     feed is the list. Wrapping <main> re-read the heading, the attention
     strip and the chips on every filter change. */
  it("announces the list, not the whole page", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [charge()])),
      ),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });

    const live = document.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0].tagName).toBe("UL");
    expect(document.querySelector("main")).not.toHaveAttribute("aria-live");
  });
});

describe("D3: failed charges surface on top", () => {
  it("shows the attention strip when failures exist", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(
          feedOf(
            url.searchParams.get("reconnection") === "failed"
              ? [charge({ id: "ch-9", reconnectionStatus: "failed", reconnectedAt: null })]
              : [charge()],
          ),
        ),
      ),
    );
    renderApp("/");

    expect(await screen.findByText(/pago fallido necesita/i)).toBeInTheDocument();
  });
});

describe("D5: the status chips re-query the feed", () => {
  it("selecting 'Fallidos' requests reconnection=failed", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push(url.searchParams.get("reconnection"));
        return ok(feedOf([charge()]));
      }),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(screen.getByRole("tab", { name: "Fallidos" }));
    await screen.findByRole("button", { name: /janely/i });

    expect(seen).toContain("failed");
  });
});

/* docs/direct-payment/partial-payment.spec.md scenario 14 (US-D10, D15):
   `receivedCents` is what arrived, the other fields are what was asked, and
   the detail has to name the difference — the row header and a derived
   breakdown total disagreed on the same card with nothing in between. */
describe("US-D10: a short payment explains itself in the feed", () => {
  /* $300.00 arrived against a $514.00 ask ($499.00 of ISP debt) */
  const partial = charge({
    id: "ch-p1",
    folio: "DV-PARC01",
    channel: "spei" as const,
    storeName: null,
    status: "partial" as const,
    reconnectionStatus: "withheld" as const,
    reconciliationClass: "short" as const,
    receivedCents: 30000,
    invoiceCents: 49900,
    askedCents: 51400,
    missingCents: 19900,
    surplusCents: 0,
    reconnectedAt: null,
  });

  it("scenario 14: the detail shows the ask, the received amount and the missing figure", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [partial])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    /* payments-and-classes D4: the class badge, not a subtitle — a
       partial that reconnected would wear a green "Reconectado" and the
       class is what keeps saying money is missing */
    expect(within(row).getByText("Pago parcial")).toBeInTheDocument();
    expect(within(row).getByText("Sin reactivar")).toBeInTheDocument();

    await userEvent.click(row);
    /* the ask keeps its breakdown, under its honest name */
    expect(await screen.findByText("Total a cobrar")).toBeInTheDocument();
    expect(screen.getByText("$514.00")).toBeInTheDocument();
    /* what arrived and what is missing — the same figure the payer's
       page shows, so both sides quote the same number on the phone */
    expect(screen.getByText("Recibido")).toBeInTheDocument();
    expect(screen.getByText("Faltan")).toBeInTheDocument();
    expect(screen.getByText("$199.00")).toBeInTheDocument();
  });

  it("a full payment keeps its plain breakdown", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [charge()])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).queryByText(/pago parcial/i)).not.toBeInTheDocument();

    await userEvent.click(row);
    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.queryByText("Total a cobrar")).not.toBeInTheDocument();
    expect(screen.queryByText("Recibido")).not.toBeInTheDocument();
    expect(screen.queryByText("Faltan")).not.toBeInTheDocument();
  });

  it("the 'Sin reactivar' chip requests reconnection=withheld", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push(url.searchParams.get("reconnection"));
        return ok(feedOf([partial]));
      }),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(screen.getByRole("tab", { name: "Sin reactivar" }));
    await screen.findByRole("button", { name: /janely/i });

    expect(seen).toContain("withheld");
  });
});
/* docs/reconciliation/payments-and-classes.spec.md — the classes PR. */
describe("US-R02: the class and the surplus explain themselves", () => {
  it("scenario 2/11: an unapplied payment reads 'resolver con el cliente', never 'queda a favor'", async () => {
    const unapplied = charge({
      id: "ch-u1",
      folio: "",
      status: "unapplied" as const,
      reconnectionStatus: null,
      reconciliationClass: "over" as const,
      receivedCents: 51400,
      surplusCents: 51400,
      reconnectedAt: null,
      attempts: 0,
    });
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(
          feedOf(
            url.searchParams.get("reconnection") === "failed" ? [] : [unapplied],
            undefined,
            /* the integration absorbs surplus — and still, unapplied money
               was never registered, so "queda a favor" would be the lie
               D14 forbids */
            "credit",
          ),
        ),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("Pago sin adeudo")).toBeInTheDocument();
    expect(within(row).getByText("Sobrante")).toBeInTheDocument();

    await userEvent.click(row);
    expect(await screen.findByText(/resolver con el cliente/)).toBeInTheDocument();
    expect(screen.queryByText(/queda a favor/)).not.toBeInTheDocument();
  });

  it("scenario 3: an over payment under the integration reads 'queda a favor del cliente'", async () => {
    const over = charge({
      id: "ch-o1",
      reconciliationClass: "over" as const,
      receivedCents: 46400,
      surplusCents: 5000,
    });
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [over], undefined, "credit")),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    await userEvent.click(row);
    expect(await screen.findByText(/queda a favor del cliente/)).toBeInTheDocument();
  });
});

describe("US-R03: the proof and the retry live on the row", () => {
  it("scenario 6: 'Ver comprobante' opens the CEP as Banxico answered it", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("reconnection") === "failed" ? [] : [charge()])),
      ),
      handlers.paymentProof((id) =>
        id === "ch-1"
          ? ok({
              folio: "DV-FEED01",
              proofMode: "transfer",
              cep: {
                trackingKey: "TRACK001XYZ",
                amountCents: 41400,
                date: "2026-09-01",
                senderBank: "NUBANK",
                senderName: "JANELY REYES",
                beneficiaryName: "WifiPlus SA de CV",
              },
              imageUrl: null,
            })
          : fail("NOT_FOUND", 404),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    await userEvent.click(row);
    await userEvent.click(await screen.findByRole("button", { name: "Ver comprobante" }));

    expect(await screen.findByText("TRACK001XYZ")).toBeInTheDocument();
    expect(screen.getByText("JANELY REYES")).toBeInTheDocument();
    expect(screen.getByText("NUBANK")).toBeInTheDocument();
    /* design-review 2026-09-01: es-MX, never raw ISO */
    expect(screen.getByText("1 de septiembre de 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-01")).not.toBeInTheDocument();
    /* the manual door sent no image, and the dialog says so */
    expect(screen.getByText(/no envió imagen/)).toBeInTheDocument();
  });

  it("scenario 7: 'Reintentar reconexión' re-queues a failed row", async () => {
    const retried: string[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() =>
        ok(feedOf([charge({ reconnectionStatus: "failed" as const, reconnectedAt: null })])),
      ),
      handlers.retryReconnection((id) => {
        retried.push(id);
        return ok({ reconnectionStatus: "queued", nextAttemptAt: Date.now() });
      }),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    await userEvent.click(row);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar reconexión" }));

    await screen.findByRole("button", { name: /janely/i });
    expect(retried).toEqual(["ch-1"]);
  });
});
/* design-review 2026-09-01 (should fix): the mobile header's height. */
describe("the date filters fold behind 'Fechas'", () => {
  it("the toggle opens the fields and reports its state", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => ok(feedOf([charge()]))),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });

    const toggle = screen.getByRole("button", { name: "Fechas" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    /* an active filter keeps the fields visible even after closing */
    await userEvent.type(screen.getByLabelText("Desde"), "2026-08-01");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
