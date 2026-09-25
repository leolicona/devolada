import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { handlers, businessActor, fail, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/legacy/admin/charge-feed.spec.md scenarios 4–6. */

const charge = (over: Partial<Parameters<typeof Object.assign>[1]> = {}) => ({
  id: "ch-1",
  folio: "DV-FEED01",
  channel: "spei" as const,
  status: "confirmed" as const,
  actionOutcome: "done" as const,
  reconciliationClass: "exact" as const,
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
  storeName: null,
  createdAt: Date.now(),
  actionDoneAt: Date.now(),
  actionAttempts: 1,
  actionError: null,
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
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [charge()])),
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
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [charge()])),
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
            url.searchParams.get("action") === "failed"
              ? [charge({ id: "ch-9", actionOutcome: "failed", actionDoneAt: null })]
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
        seen.push(url.searchParams.get("action"));
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

/* docs/legacy/direct-payment/partial-payment.spec.md scenario 14 (US-D10, D15):
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
    actionOutcome: "withheld" as const,
    reconciliationClass: "short" as const,
    receivedCents: 30000,
    invoiceCents: 49900,
    askedCents: 51400,
    missingCents: 19900,
    surplusCents: 0,
    actionDoneAt: null,
  });

  it("scenario 14: the detail shows the ask, the received amount and the missing figure", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [partial])),
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
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [charge()])),
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
        seen.push(url.searchParams.get("action"));
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
/* docs/legacy/reconciliation/payments-and-classes.spec.md — the classes PR. */
describe("US-R02: the class and the surplus explain themselves", () => {
  it("scenario 2/11: an unapplied payment reads 'resolver con el cliente', never 'queda a favor'", async () => {
    const unapplied = charge({
      id: "ch-u1",
      folio: "",
      status: "unapplied" as const,
      actionOutcome: null,
      reconciliationClass: "over" as const,
      receivedCents: 51400,
      surplusCents: 51400,
      actionDoneAt: null,
      actionAttempts: 0,
    });
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(
          feedOf(
            url.searchParams.get("action") === "failed" ? [] : [unapplied],
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
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [over], undefined, "credit")),
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
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [charge()])),
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

  it("automated-collections-api US2 (FR-026): an API payment's outcome speaks the webhook's words, and its retry is a re-send", async () => {
    const retried: string[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() =>
        ok(
          feedOf([
            charge({ id: "api-1", source: "api" as const, customerName: "CLI-4471", actionOutcome: "done" as const }),
            charge({ id: "api-2", source: "api" as const, customerName: "CLI-4472", actionOutcome: "queued" as const, actionDoneAt: null }),
            charge({ id: "api-3", source: "api" as const, customerName: "CLI-4473", actionOutcome: "failed" as const, actionDoneAt: null, actionAttempts: 6 }),
          ]),
        ),
      ),
      handlers.retryReconnection((id) => {
        retried.push(id);
        return ok({ actionOutcome: "queued", nextAttemptAt: Date.now() });
      }),
    );
    renderApp("/");
    expect(await screen.findByText("Entregado")).toBeInTheDocument();
    expect(screen.getByText("Reintentando")).toBeInTheDocument();
    expect(screen.getByText("Sin entregar")).toBeInTheDocument();
    /* the WispHub badges never appear on these rows (the filter tab
       "Reconectados" is the feed's, not a row's) */
    expect(screen.queryByText("Reconectado")).not.toBeInTheDocument();
    expect(screen.queryByText("Reconexión en cola")).not.toBeInTheDocument();
    expect(screen.queryByText("Fallido")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cli-4473/i }));
    expect(await screen.findByText(/intentos de aviso al sistema: 6/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reenviar aviso" }));
    await screen.findByRole("button", { name: /cli-4473/i });
    expect(retried).toEqual(["api-3"]);
  });

  it("scenario 7: 'Reintentar reconexión' re-queues a failed row", async () => {
    const retried: string[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() =>
        ok(feedOf([charge({ actionOutcome: "failed" as const, actionDoneAt: null })])),
      ),
      handlers.retryReconnection((id) => {
        retried.push(id);
        return ok({ actionOutcome: "queued", nextAttemptAt: Date.now() });
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
/* payments-and-classes D4, 2026-09-02 revision: the date filter is a
   calendar of our own, staged behind Aplicar. Two triggers live in the
   DOM (sheet under sm, popover above; CSS shows one) — happy-dom hides
   neither, so the first is the sheet's, as shell.test.tsx reads the two
   navs. The stub feed says today started at 2026-08-14 00:00 in the
   business's zone (Mexico City), so every date below is deterministic. */
describe("US-R03: the date range is a calendar — presets apply, Aplicar commits, closing discards, Limpiar clears", () => {
  const seen: { from: string | null; to: string | null }[] = [];
  const setup = () => {
    seen.length = 0;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
        return ok(feedOf([charge()]));
      }),
    );
    renderApp("/");
  };
  const trigger = () => screen.getAllByRole("button", { name: /Fechas|ago/ })[0];

  it("a preset is a complete answer: 'Últimos 7 días' applies in the business's zone and names itself", async () => {
    setup();
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Últimos 7 días" }));

    expect((await screen.findAllByRole("button", { name: /8–14 ago/ }))[0]).toBeInTheDocument();
    expect(seen.at(-1)).toEqual({ from: "2026-08-08", to: "2026-08-14" });
    /* the sheet closed on its own */
    expect(screen.queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument();
  });

  it("one day + Aplicar is that day, not an open range", async () => {
    setup();
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: /13 de agosto/ }));
    expect(screen.getByText("13 ago")).toBeInTheDocument(); /* the preview says what Aplicar will do */
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    expect((await screen.findAllByRole("button", { name: /13 ago/ }))[0]).toBeInTheDocument();
    expect(seen.at(-1)).toEqual({ from: "2026-08-13", to: "2026-08-13" });
  });

  it("closing without Aplicar discards the draft", async () => {
    setup();
    await screen.findByRole("button", { name: /janely/i });
    const before = seen.length;

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: /13 de agosto/ }));
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Aplicar" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Fechas" }).length).toBeGreaterThan(0);
    expect(seen.slice(before).some((s) => s.from !== null)).toBe(false);
  });

  it("Limpiar clears and applies in one tap; tomorrow cannot be picked", async () => {
    setup();
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(trigger());
    await userEvent.click(await screen.findByRole("button", { name: "Hoy" }));
    expect(seen.at(-1)).toEqual({ from: "2026-08-14", to: "2026-08-14" });

    await userEvent.click(screen.getAllByRole("button", { name: /14 ago/ })[0]);
    /* the business's today is the 14th: the 15th is disabled */
    expect(await screen.findByRole("button", { name: /15 de agosto/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(seen.at(-1)).toEqual({ from: null, to: null });
    expect(screen.getAllByRole("button", { name: "Fechas" }).length).toBeGreaterThan(0);
  });
});

/* payments-and-classes D10 (pagos-filtros review, 2026-09-02) — the
   US-P01 principle: a list filtered down to nothing is not a business
   that was never paid, and the copy must say which it is. */
describe("US-R03: a filtered-to-nothing list never claims the business has never been paid", () => {
  it("shows the no-match copy with a clear action, and clearing brings the rows back", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        const filtered = url.searchParams.get("class") === "short" || url.searchParams.get("action") === "failed";
        return ok(feedOf(filtered ? [] : [charge()]));
      }),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });

    await userEvent.click(screen.getByRole("tab", { name: "Pago parcial" }));
    expect(await screen.findByText(/Ningún pago coincide con estos filtros/)).toBeInTheDocument();
    expect(screen.queryByText(/Sin pagos por aquí todavía/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(await screen.findByRole("button", { name: /janely/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Todos" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the first-run copy when nothing is filtered", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => ok(feedOf([], { count: 0, totalCents: 0, startedAtMs: Date.UTC(2026, 7, 14, 6) }))),
    );
    renderApp("/");
    expect(await screen.findByText(/Sin pagos por aquí todavía/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
  });
});
/* docs/legacy/integrations/integrations-hub.spec.md — the hub's face in Pagos. */
describe("US-I03: the observed row teaches, and Ejecutar ahora dispatches", () => {
  const observed = charge({
    id: "ch-obs1",
    status: "confirmed" as const,
    actionOutcome: "observation" as const,
    observedAction: "register_and_reconnect:reconnect",
    actionDoneAt: null,
    actionAttempts: 0,
  });

  it("scenario 4 (UI): badge Observación, the hypothesis line, and the button posts execute-action", async () => {
    const executed: string[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [observed])),
      ),
      handlers.executeAction((id) => {
        executed.push(id);
        return ok({ actionOutcome: "done", nextAttemptAt: null });
      }),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("Observación")).toBeInTheDocument();

    await userEvent.click(row);
    expect(await screen.findByText("Se habría reconectado.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ejecutar ahora" }));
    await screen.findByRole("button", { name: /janely/i });
    expect(executed).toEqual(["ch-obs1"]);
  });

  it("scenario 6: a withheld row offers no Ejecutar ahora — the threshold is the law", async () => {
    const withheld = charge({
      id: "ch-w1",
      status: "partial" as const,
      actionOutcome: "withheld" as const,
      reconciliationClass: "short" as const,
      actionDoneAt: null,
    });
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [withheld])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    await userEvent.click(row);
    expect(await screen.findByText(/intentos de reconexión/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).not.toBeInTheDocument();
  });

  it("D7: done under register_only wears Registrado, never Reconectado", async () => {
    const registered = charge({
      id: "ch-r1",
      actionOutcome: "done" as const,
      dispatchedAction: "register_only" as const,
    });
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [registered])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("Registrado")).toBeInTheDocument();
    expect(within(row).queryByText("Reconectado")).not.toBeInTheDocument();
  });
});
/* pilot-UX round: money in flight is visible by default. */
describe("pilot-UX: Verificando en Pagos", () => {
  const inFlight = charge({
    id: "ch-v1",
    folio: "",
    status: "validating" as const,
    actionOutcome: null,
    reconciliationClass: null,
    actionDoneAt: null,
    actionAttempts: 0,
  });

  it("a validating row rides the default list wearing 'Verificando pago'", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [inFlight])),
      ),
    );
    renderApp("/");
    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("Verificando pago")).toBeInTheDocument();
  });

  it("the 'Verificando' chip requests status=validating", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push(url.searchParams.get("status"));
        return ok(feedOf([inFlight]));
      }),
    );
    renderApp("/");
    await screen.findByRole("button", { name: /janely/i });
    await userEvent.click(screen.getByRole("tab", { name: "Verificando" }));
    await screen.findByRole("button", { name: /janely/i });
    expect(seen).toContain("validating");
  });
});

/* receipt-triage US3 (plan D31, contracts/review.md): a payment Banxico
   confirmed that waits for the business — paid to an account it removed,
   or found by reference with no clave. */
describe("receipt-triage US3: the held row asks the business to decide", () => {
  const held = (over: Record<string, unknown> = {}) =>
    charge({
      id: "ch-rev1",
      actionOutcome: "review" as const,
      reviewReason: "retired_account",
      reviewAccount: { kind: "card", last4: "4321" },
      observedAction: "register_and_reconnect:reconnect",
      actionDoneAt: null,
      actionAttempts: 0,
      ...over,
    });

  it("a removed account: En revisión, which account, and both decisions post to the review route", async () => {
    const decisions: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [held()]))),
      handlers.reviewPayment((id, body) => {
        decisions.push({ id, body });
        return ok({ status: "confirmed", actionOutcome: "done" });
      }),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("En revisión")).toBeInTheDocument();
    await userEvent.click(row);
    expect(
      await screen.findByText(
        "Pagó a tu tarjeta ••••4321, que ya no está registrada. Banxico confirmó la transferencia.",
      ),
    ).toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: "Aceptar pago" }));
    await userEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    expect(decisions).toEqual([
      { id: "ch-rev1", body: { decision: "accept" } },
      { id: "ch-rev1", body: { decision: "reject" } },
    ]);
  });

  it("no clave: the sentence says what to check", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("action") === "failed" ? [] : [held({ reviewReason: "no_clave", reviewAccount: null })])),
      ),
    );
    renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: /janely/i }));
    expect(
      await screen.findByText(
        "Banxico confirmó la transferencia sin clave de rastreo; revisa que no la hayas cobrado ya.",
      ),
    ).toBeInTheDocument();
  });
});
