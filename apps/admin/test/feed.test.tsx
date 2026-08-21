import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feedResponse } from "@devolada/api/charges-schema";
import { handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/charge-feed.spec.md scenarios 4–6. */

const charge = (over: Partial<Parameters<typeof Object.assign>[1]> = {}) => ({
  id: "ch-1",
  folio: "DV-FEED01",
  channel: "store" as const,
  reconnectionStatus: "reconnected" as const,
  totalCents: 41400,
  invoiceCents: 39900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
  customerName: "Janely",
  storeName: "Abarrotes La Esquina",
  createdAt: Date.now(),
  reconnectedAt: Date.now(),
  attempts: 1,
  lastError: null,
  ...over,
});

function feedOf(
  charges: unknown[],
  today = { count: 2, totalCents: 82800, startedAtMs: Date.UTC(2026, 7, 14, 6) },
) {
  return feedResponse.parse({ charges, nextCursor: null, today });
}

describe("US-A01: the feed shows rows and expands into detail", () => {
  it("renders customer, store, badge and amount; expanding shows folio and breakdown", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
      handlers.feed((url) =>
        ok(feedOf(url.searchParams.get("status") === "failed" ? [] : [charge()])),
      ),
    );
    renderApp("/");

    const row = await screen.findByRole("button", { name: /janely/i });
    expect(within(row).getByText("Abarrotes La Esquina")).toBeInTheDocument();
    expect(within(row).getByText("Reconectado")).toBeInTheDocument();
    expect(screen.getByText(/hoy:/i)).toHaveTextContent("$828.00");

    await userEvent.click(row);
    expect(await screen.findByText("Folio DV-FEED01")).toBeInTheDocument();
    expect(screen.getByText("Mensualidad")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
  });

  /* design-review D9: charge-feed asked for the feed to announce, and the
     feed is the list. Wrapping <main> re-read the heading, the attention
     strip and the chips on every filter change. */
  it("announces the list, not the whole page", async () => {
    server.use(
      handlers.session(() => ok(ispActor)),
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
      handlers.session(() => ok(ispActor)),
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

    expect(await screen.findByText(/cobro fallido necesita/i)).toBeInTheDocument();
  });
});

describe("D5: the status chips re-query the feed", () => {
  it("selecting 'Fallidos' requests status=failed", async () => {
    const seen: (string | null)[] = [];
    server.use(
      handlers.session(() => ok(ispActor)),
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
