import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/payments-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/charge-feed.spec.md scenarios 4–6. */

const charge = (over: Partial<Parameters<typeof Object.assign>[1]> = {}) => ({
  id: "ch-1",
  folio: "DV-FEED01",
  channel: "spei" as const,
  reconnectionStatus: "reconnected" as const,
  receivedCents: 41400,
  invoiceCents: 39900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
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
) {
  return feedResponse.parse({ payments: rows, nextCursor: null, today });
}

describe("US-A01: the feed shows rows and expands into detail", () => {
  it("renders customer, channel, badge and amount; expanding shows folio and breakdown", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("status") === "failed" ? [] : [charge()])),
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
        ok(feedOf(url.searchParams.get("status") === "failed" ? [] : [charge()])),
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
            url.searchParams.get("status") === "failed"
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
  it("selecting 'Fallidos' requests status=failed", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push(url.searchParams.get("status"));
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
    reconnectionStatus: "withheld" as const,
    receivedCents: 30000,
    invoiceCents: 49900,
    reconnectedAt: null,
  });

  it("scenario 14: the detail shows the ask, the received amount and the missing figure", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("status") === "failed" ? [] : [partial])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    /* the label, not only the badge: a partial that reconnected would
       wear a green "Reconectado" and pass for a full payment */
    expect(within(row).getByText(/pago directo · spei · pago parcial/i)).toBeInTheDocument();
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
        ok(feedOf(url.searchParams.get("status") === "failed" ? [] : [charge()])),
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

  it("the 'Sin reactivar' chip requests status=withheld", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed((url) => {
        seen.push(url.searchParams.get("status"));
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
