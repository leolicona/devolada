import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { customersResponse } from "@devolada/api/direct-payments-schema";
import { feedResponse } from "@devolada/api/payments-schema";
import { providerQuotaResponse, settingsListResponse } from "@devolada/api/platform-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* payment-without-receipt (contracts/panel.md): the panel only reads.
   The system decides every reference alone (D4, D6, D26), so what the
   business sees is text — a customer's reference on Links, the path that
   confirmed a payment in Pagos — and the platform operator sees the
   provider's remaining calls in /operador. The switch has its own tests
   in settings.test.tsx. */

const panel = (over: Record<string, unknown> = {}) => ({
  channel: "panel",
  usuario: "greyes",
  wisphubId: 101,
  customerRef: null,
  label: null,
  askCents: null,
  linkState: null,
  name: "Janely Reyes",
  phone: "5551234567",
  hasLink: true,
  url: "https://link.dev.devoladapago.com/p/tok-greyes",
  waLink: "https://wa.me/525551234567?text=hola",
  ...over,
});

const apiRow = (over: Record<string, unknown> = {}) => ({
  channel: "api",
  usuario: null,
  wisphubId: null,
  customerRef: "CLI-4471",
  label: "Ana Ruiz",
  askCents: 49900,
  linkState: "open",
  name: "Ana Ruiz",
  phone: null,
  hasLink: true,
  url: "https://link.dev.devoladapago.com/p/tok-cli4471",
  waLink: "https://wa.me/?text=hola",
  ...over,
});

const block = (rows: unknown[]) =>
  customersResponse.parse({ results: rows, nextCursor: null, matched: null, total: rows.length, wisphub: "ok" });

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("payment-without-receipt US1: a customer's reference on Links, to read", () => {
  const arrange = (rows: unknown[]) => {
    server.use(handlers.session(() => ok(businessActor)), handlers.customers(() => ok(block(rows))));
    return renderApp("/links");
  };

  it("shows «Ref. 234 5678 · celular» for a phone's digits and «Ref. 781 2044 · asignada» for an assigned number", async () => {
    arrange([
      panel({ payerReference: { digits: "2345678", origin: "phone" } }),
      apiRow({ payerReference: { digits: "7812044", origin: "assigned" } }),
    ]);
    await screen.findByText("Janely Reyes");

    expect(within(rowOf("Janely Reyes")).getByText("Ref. 234 5678 · celular")).toBeInTheDocument();
    expect(within(rowOf("Ana Ruiz")).getByText("Ref. 781 2044 · asignada")).toBeInTheDocument();
    /* Under the row's own identity line, which is unchanged */
    expect(within(rowOf("Janely Reyes")).getByText("greyes · 5551234567")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the reference is text: nothing to press over it, and it opens no profile (clarified 2026-09-30)", async () => {
    const router = arrange([panel({ payerReference: { digits: "2345678", origin: "phone" } })]);
    await screen.findByText("Janely Reyes");

    const line = screen.getByText("Ref. 234 5678 · celular");
    expect(line.closest("a, button, [role='button'], [role='link'], [tabindex]:not([tabindex='-1'])")).toBeNull();
    /* The row offers exactly what it offered before: the link's two acts */
    const row = rowOf("Janely Reyes");
    expect(within(row).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Copiar", "WhatsApp"]);
    expect(within(row).queryAllByRole("link")).toHaveLength(0);

    await userEvent.click(line);
    expect(router.state.location.pathname).toBe("/links");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("with no reference, the row is today's — absent and null render the same row, with no «Ref.»", async () => {
    arrange([
      panel(),
      panel({ usuario: "aflores", wisphubId: 102, name: "Abraham Flores", phone: "5559876543", payerReference: null }),
    ]);
    await screen.findByText("Janely Reyes");

    expect(screen.queryByText(/^Ref\./)).not.toBeInTheDocument();
    const absent = rowOf("Janely Reyes");
    const nulled = rowOf("Abraham Flores");
    /* The same markup, name and identity aside */
    expect(nulled.innerHTML.replaceAll("Abraham Flores", "N").replaceAll("aflores · 5559876543", "I")).toBe(
      absent.innerHTML.replaceAll("Janely Reyes", "N").replaceAll("greyes · 5551234567", "I"),
    );
    expect(within(absent).getByText("greyes · 5551234567")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch-1",
  folio: "DV-REF001",
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
  createdAt: Date.UTC(2026, 8, 30, 18, 0),
  actionDoneAt: Date.UTC(2026, 8, 30, 18, 1),
  actionAttempts: 1,
  actionError: null,
  ...over,
});

const feedOf = (rows: unknown[]) =>
  feedResponse.parse({
    payments: rows,
    nextCursor: null,
    effectiveOverTreatment: "flag",
    today: { count: rows.length, totalCents: 41400 * rows.length, startedAtMs: Date.UTC(2026, 8, 30, 6) },
  });

describe("payment-without-receipt US2: the feed says which path confirmed a payment", () => {
  it("«Con su referencia» for `own`, «Con referencia escrita» for `typed`, beside the StatusBadge — and no other mark", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() =>
        ok(
          feedOf([
            charge({ id: "ch-a", customerName: "Aurora", referenceSource: null }),
            charge({ id: "ch-b", customerName: "Beatriz", referenceSource: "own" }),
            charge({ id: "ch-c", customerName: "Carmen", referenceSource: "typed" }),
            /* A row from before the feature, or of a business with it off */
            charge({ id: "ch-d", customerName: "Dolores" }),
          ]),
        ),
      ),
    );
    renderApp("/");

    const plain = await screen.findByRole("button", { name: /aurora/i });
    const own = screen.getByRole("button", { name: /beatriz/i });
    const typed = screen.getByRole("button", { name: /carmen/i });
    const before = screen.getByRole("button", { name: /dolores/i });

    const ownWords = within(own).getByText("Con su referencia");
    const typedWords = within(typed).getByText("Con referencia escrita");
    /* Beside the badge, in text: the element right before it is the StatusBadge */
    expect(ownWords.previousElementSibling).toHaveTextContent("Reconectado");
    expect(typedWords.previousElementSibling).toHaveTextContent("Reconectado");
    expect(ownWords.querySelector("svg")).toBeNull();
    expect(within(own).queryByText("Con referencia escrita")).not.toBeInTheDocument();
    expect(within(typed).queryByText("Con su referencia")).not.toBeInTheDocument();

    for (const row of [plain, before]) {
      expect(within(row).queryByText(/referencia/i)).not.toBeInTheDocument();
    }
    /* No other mark: the same icons as a row confirmed any other way, and
       the same words once the name and the path are set aside */
    const icons = (row: HTMLElement) => row.querySelectorAll("svg").length;
    const words = (row: HTMLElement, name: string, path = "") =>
      (row.textContent ?? "").replace(name, "").replace(path, "");
    for (const [row, name, path] of [
      [own, "Beatriz", "Con su referencia"],
      [typed, "Carmen", "Con referencia escrita"],
    ] as const) {
      expect(icons(row)).toBe(icons(plain));
      expect(words(row, name, path)).toBe(words(plain, "Aurora"));
    }
    await expectNoViolations(document.body);
  });
});

const operator = { ...businessActor, platformOperator: true };

/* The shell around any route asks for these (operator-bank.test.tsx) */
const shell = () => [
  handlers.feed(() => ok(feedOf([]))),
  handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
  handlers.platformSettings(() =>
    ok(
      settingsListResponse.parse({
        settings: [{ key: "validation_fee_cents", type: "cents", birth: null, current: "300", history: [] }],
      }),
    ),
  ),
];

describe("payment-without-receipt US4: the provider's remaining calls, for the platform operator", () => {
  it("the Reglas tab reads «Consultas restantes del proveedor: 612 (hace 3 min)»", async () => {
    server.use(
      ...shell(),
      handlers.session(() => ok(operator)),
      handlers.providerQuota(() =>
        ok(
          providerQuotaResponse.parse({
            provider: "apicep",
            remaining: 612,
            /* three minutes and a few seconds: floored, never rounded up */
            observedAt: Date.now() - 3 * 60_000 - 20_000,
          }),
        ),
      ),
    );
    renderApp("/operador");

    expect(await screen.findByText("Consultas restantes del proveedor: 612 (hace 3 min)")).toBeInTheDocument();
    /* The rules are still there beneath it */
    expect(await screen.findByLabelText("Tarifa por validación")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("says nothing while no answer has carried the header (null)", async () => {
    let asked = 0;
    server.use(
      ...shell(),
      handlers.session(() => ok(operator)),
      handlers.providerQuota(() => {
        asked += 1;
        return ok(providerQuotaResponse.parse(null));
      }),
    );
    renderApp("/operador");

    expect(await screen.findByLabelText("Tarifa por validación")).toBeInTheDocument();
    await waitFor(() => expect(asked).toBe(1));
    expect(screen.queryByText(/consultas restantes/i)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a business's own people never ask for it: /operador sends them to Pagos", async () => {
    let asked = 0;
    server.use(
      ...shell(),
      handlers.session(() => ok(businessActor)),
      handlers.providerQuota(() => {
        asked += 1;
        return ok(null);
      }),
    );
    const router = renderApp("/operador");

    await screen.findByRole("heading", { name: "Pagos" });
    expect(router.state.location.pathname).toBe("/payments");
    expect(asked).toBe(0);
    expect(screen.queryByText(/consultas restantes/i)).not.toBeInTheDocument();
  });
});
