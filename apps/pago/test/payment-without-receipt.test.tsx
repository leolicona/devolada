import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BANKS,
  directPaymentStatusResponse,
  linkStatusResponse,
  payRequest,
  payResponse,
  proofReadingResponse,
  proofUploadResponse,
  PAY_REFUSALS_WITHOUT_RECEIPT,
} from "@devolada/api/direct-payments-schema";
import { App } from "../src/App";
import { REFERENCE_HINTS } from "../src/features/pago/reference-hints";
import { fail, handlers, ok, server } from "./msw";
import { expectNoViolations } from "./a11y";

/* specs/012-payment-without-receipt — the payer's page (contracts/
   payment-page.md): the reference on step 1 (payment-without-receipt
   US1), "Confirma tu pago" (US2), the banks it remembers (US3), the
   read-back and the ladder (US4), and "No puse la referencia" (US5).

   Every fixture is parsed by the contract the API exports, and every body
   the page sends is parsed by `payRequest` — a page that sends what the
   server would refuse fails here, not on a phone. */

/* The step (step.ts) and "Todo está bien" (ask-ack.ts) live on the device:
   a test starts from an empty one or it is not a test. */
beforeEach(() => {
  window.localStorage.clear();
  /* Tuesday 29 September 2026, 21:00 in Mexico City — already Wednesday
     the 30th in UTC. Every "Hoy" below is the business's day, so a page
     reading the browser's UTC date would say "miércoles 30" and fail.
     Only `Date` is faked: MSW, the poll and user events keep real timers
     (the bug: spei-date-rollover pattern). */
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage(path = "/p/tok123") {
  window.history.pushState({}, "", path);
  render(<App />);
}

const reference = (over: Record<string, unknown> = {}) => ({
  digits: "2345678",
  fromPhone: true,
  proven: false,
  previousDigits: null,
  ...over,
});

const baseLink = {
  ispName: "WifiPlus",
  customerName: "Janely",
  status: "debt",
  invoiceCents: 49900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
  totalCents: 51400,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "WifiPlus SA de CV",
  reference: "greyes@wifiplus",
  collectAccount: { kind: "clabe", value: "646180157000000004", bank: "STP" },
  timezone: "America/Mexico_City",
};

const linkWith = (over: Record<string, unknown> = {}) =>
  linkStatusResponse.parse({
    ...baseLink,
    payerReference: reference(),
    learnedBanks: ["AZTECA"],
    bankOrder: ["BBVA MEXICO", "AZTECA", "NUBANK"],
    ...over,
  });

/* A row searched by the payer's own reference, validating (D15, D23) */
const sourced = (over: Record<string, unknown> = {}) =>
  directPaymentStatusResponse.parse({
    status: "validating",
    validationAttempts: 2,
    nextValidationAt: null,
    error: null,
    trackingKey: null,
    senderBank: "AZTECA",
    transferDate: "2026-09-29",
    claimedAmountCents: 51400,
    referenceNumber: "2345678",
    referenceSource: "own",
    senderTail: null,
    searchedDays: ["2026-09-29"],
    ask: null,
    usedBy: null,
    ...over,
  });

/* Handlers for a link, the pay route and the status route. The pay route
   parses every body with the exported contract and records it. */
function stub({
  link = linkWith(),
  paid = [],
  payAnswer,
  status = sourced(),
}: {
  link?: unknown;
  paid?: unknown[];
  payAnswer?: (body: unknown, n: number) => ReturnType<typeof ok | typeof fail>;
  status?: unknown | (() => unknown);
} = {}) {
  server.use(
    handlers.link(() => ok(link)),
    handlers.pay((body) => {
      payRequest.parse(body);
      paid.push(body);
      return (
        payAnswer?.(body, paid.length) ??
        ok(payResponse.parse({ directPaymentId: `dp-${paid.length + 1}`, status: "validating", error: null }), 201)
      );
    }),
    handlers.status(() => ok(typeof status === "function" ? (status as () => unknown)() : status)),
  );
  return paid;
}

/* A payer coming back to the attempt still in review (bug: one-open-attempt):
   the status route decides everything on the screen */
function stubInReview(status: unknown, paid: unknown[] = [], over: Record<string, unknown> = {}) {
  return stub({
    link: linkWith({ inReview: { directPaymentId: "dp-1", status: "validating" }, ...over }),
    paid,
    status,
  });
}

async function goToStep2() {
  await userEvent.click(await screen.findByRole("button", { name: /ya hice mi transferencia/i }));
}

/* Step 2 with a reference already proven: the confirmation, no question */
async function openConfirmation() {
  await goToStep2();
  await screen.findByRole("heading", { name: "Confirma tu pago" });
}

/* ======================================================================
   US1 — the payer knows their reference before they pay
   ====================================================================== */

describe("payment-without-receipt US1: the reference on step 1", () => {
  it("shows 'Tu referencia' grouped, copies the digits, says it is the phone's, where it goes and to save it", async () => {
    const user = userEvent.setup();
    stub();
    renderPage();

    expect(await screen.findByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
    expect(screen.getByText("234 5678").previousElementSibling).toHaveTextContent("Tu referencia");
    expect(screen.getByText("Son los últimos 7 números de tu celular")).toBeInTheDocument();
    /* FR-004: the general sentence — REFERENCE_HINTS has no verified bank yet */
    expect(screen.getByText("Escríbela en «Referencia numérica», no en «Concepto».")).toBeInTheDocument();
    expect(screen.getByText(/guarda a wifiplus como contacto en tu banco con esta referencia/i)).toBeInTheDocument();

    /* A bank takes the seven digits, not "234 5678" */
    await user.click(screen.getByRole("button", { name: "Copiar Tu referencia" }));
    expect(await navigator.clipboard.readText()).toBe("2345678");

    /* The concepto keeps its name and its place (D22) */
    await user.click(screen.getByRole("button", { name: /ver los demás datos/i }));
    expect((await screen.findByText("greyes@wifiplus")).previousElementSibling).toHaveTextContent("Concepto");
    await expectNoViolations(document.body);
  });

  it("an assigned number is never called the phone's (FR-004)", async () => {
    stub({ link: linkWith({ payerReference: reference({ digits: "7812044", fromPhone: false }) }) });
    renderPage();
    expect(await screen.findByText("781 2044")).toBeInTheDocument();
    expect(screen.queryByText(/últimos 7 números de tu celular/i)).not.toBeInTheDocument();
  });

  it("a verified hint for the payer's most recent bank replaces the general sentence (receipt-triage D19's rule)", async () => {
    /* The record ships empty until Banco Azteca is verified by hand
       (T052); the page must already use an entry when one exists */
    REFERENCE_HINTS.AZTECA = {
      text: "En Azteca, escríbela en «Referencia numérica», no en «Concepto».",
      source: "test fixture",
      verified: "2026-09-30",
    };
    try {
      stub({ link: linkWith({ learnedBanks: ["AZTECA", "NUBANK"] }) });
      renderPage();
      expect(
        await screen.findByText("En Azteca, escríbela en «Referencia numérica», no en «Concepto»."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Escríbela en «Referencia numérica», no en «Concepto».")).not.toBeInTheDocument();
    } finally {
      delete REFERENCE_HINTS.AZTECA;
    }
  });

  it("with the feature off (no payerReference), step 1 and step 2 are today's", async () => {
    for (const payerReference of [null, undefined]) {
      stub({ link: linkStatusResponse.parse({ ...baseLink, payerReference }) });
      renderPage();
      expect(await screen.findByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
      expect(screen.queryByText("Tu referencia")).not.toBeInTheDocument();
      expect(screen.getByText("Al terminar, toma captura del detalle")).toBeInTheDocument();
      expect(screen.getByText(/vuelve aquí con tu comprobante/i)).toBeInTheDocument();
      await goToStep2();
      expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /confirmar pago/i })).not.toBeInTheDocument();
      cleanup();
      window.localStorage.clear();
    }
  });

  it("scenario 6: a capture with another reference is accepted by receipt, and the payer is reminded of theirs", async () => {
    const paid: unknown[] = [];
    stub({
      link: linkWith({ payerReference: reference({ proven: true }) }),
      paid,
      status: directPaymentStatusResponse.parse({ status: "validating", validationAttempts: 1, error: null }),
    });
    server.use(
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.read(() =>
        ok(
          proofReadingResponse.parse({
            source: "reader",
            isReceipt: true,
            legibility: "full",
            amountCents: 51400,
            trackingKey: "260929071144393084I",
            senderBank: "AZTECA",
            date: "2026-09-29",
            receiptStatus: "Aceptada",
            referenceNumber: "9784417",
            gate: { trackingKey: "ok", senderBank: "ok", amount: "ok", referenceNumber: "ok" },
          }),
        ),
      ),
    );
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: "Sube tu comprobante" }));
    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
    await userEvent.upload(
      screen.getByLabelText(/captura o comprobante/i),
      new File([new Uint8Array(100)], "cep.png", { type: "image/png" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /enviar comprobante/i }));

    await waitFor(() => expect(paid).toHaveLength(1));
    /* the receipt path, untouched: the file alone, nothing refused */
    expect(paid[0]).toMatchObject({ proofId: "link-1/proof-1" });
    expect(paid[0]).not.toHaveProperty("transfer");
    expect(
      await screen.findByText(/tu referencia es 234 5678\. escríbela en tu próxima transferencia/i),
    ).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

/* ======================================================================
   US2 — the payer confirms with bank and day
   ====================================================================== */

describe("payment-without-receipt US2: Confirma tu pago", () => {
  it("opens on the first-time question; 'No' spends nothing and opens 'No puse la referencia'", async () => {
    const paid = stub();
    renderPage();
    await goToStep2();

    expect(screen.getByRole("heading", { name: "Confirma tu pago" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /envía tu comprobante/i })).not.toBeInTheDocument();
    expect(screen.getByText("¿Pusiste la referencia 234 5678 en tu transferencia?")).toBeInTheDocument();
    /* FR-027: nothing else is asked before the answer */
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar pago/i })).not.toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("heading", { name: "No puse la referencia" })).toBeInTheDocument();
    expect(paid).toHaveLength(0);
  });

  it("'Sí' continues: bank and day preselected in the business's timezone, the read-back, and a confirmation with no reference", async () => {
    const paid = stub();
    renderPage();
    await goToStep2();
    await userEvent.click(screen.getByRole("button", { name: "Sí" }));

    const bank = screen.getByRole("group", { name: "¿Desde qué banco pagaste?" });
    expect(within(bank).getByRole("radio", { name: "Banco Azteca" })).toBeChecked();
    expect(within(bank).getByRole("radio", { name: "Otro banco" })).not.toBeChecked();

    /* 21:00 on the 29th in Mexico City is the 30th in UTC: the business's
       day decides */
    const day = screen.getByRole("group", { name: "¿Qué día?" });
    expect(within(day).getByRole("radio", { name: "Hoy, martes 29" })).toBeChecked();
    expect(within(day).getByRole("radio", { name: "Ayer, lunes 28" })).toBeInTheDocument();
    expect(within(day).getByRole("radio", { name: "Otro día" })).toBeInTheDocument();
    expect(screen.queryByText(/miércoles 30/)).not.toBeInTheDocument();

    expect(
      screen.getByText("Buscaremos $514.00 con la referencia 234 5678, desde Banco Azteca, hoy martes 29."),
    ).toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    await waitFor(() => expect(paid).toHaveLength(1));
    /* D8: the server writes the reference; the page never sends one */
    expect(paid[0]).toEqual({
      transfer: {
        referenceSource: "own",
        senderBank: "AZTECA",
        date: "2026-09-29",
        preselected: { bank: "AZTECA", day: "2026-09-29" },
      },
    });
    expect(await screen.findByText("Seguimos buscando tu transferencia en Banxico.")).toBeInTheDocument();
  });

  it("the read-back follows every choice, and 'Otro día' is bounded to the last 30 days", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: true }) }) });
    renderPage();
    await openConfirmation();

    await userEvent.click(screen.getByRole("radio", { name: "Ayer, lunes 28" }));
    expect(screen.getByText(/, ayer lunes 28\.$/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Otro día" }));
    const field = screen.getByLabelText("Fecha de la transferencia");
    expect(field).toHaveAttribute("min", "2026-08-30");
    expect(field).toHaveAttribute("max", "2026-09-29");
    /* Nothing chosen yet: the day is left out of the sentence, not guessed */
    expect(screen.getByText("Buscaremos $514.00 con la referencia 234 5678, desde Banco Azteca.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar pago/i })).toBeDisabled();

    /* 31 days back is outside the window */
    fireEvent.change(field, { target: { value: "2026-08-29" } });
    expect(screen.getByRole("button", { name: /confirmar pago/i })).toBeDisabled();

    fireEvent.change(field, { target: { value: "2026-09-20" } });
    expect(
      screen.getByText("Buscaremos $514.00 con la referencia 234 5678, desde Banco Azteca, el domingo 20 de septiembre."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Otro banco" }));
    await userEvent.selectOptions(screen.getByLabelText("Elige tu banco"), "NUBANK");
    expect(screen.getByText(/desde Nu, el domingo 20 de septiembre\.$/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({
      transfer: {
        referenceSource: "own",
        senderBank: "NUBANK",
        date: "2026-09-20",
        /* D23: what was offered, not what was sent */
        preselected: { bank: "AZTECA", day: "2026-09-29" },
      },
    });
  });

  it("'Pagué otra cantidad' changes the read-back and adds amountCents (FR-009)", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: true }) }) });
    renderPage();
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Pagué otra cantidad" }));
    const amount = screen.getByLabelText("Monto que transferiste");
    expect(amount).toHaveValue("514.00");
    await userEvent.clear(amount);
    await userEvent.type(amount, "300");
    expect(
      screen.getByText("Buscaremos $300.00 con la referencia 234 5678, desde Banco Azteca, hoy martes 29."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({ transfer: { referenceSource: "own", amountCents: 30000 } });
    expect((paid[0] as { transfer: object }).transfer).not.toHaveProperty("referenceNumber");
  });

  it("a proven reference asks no question, and the exits are there: 'No puse la referencia', 'Sube tu comprobante'", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: true }) }) });
    renderPage();
    await openConfirmation();

    expect(screen.queryByText(/¿pusiste la referencia/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar pago/i })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "No puse la referencia" }));
    expect(screen.getByRole("heading", { name: "No puse la referencia" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sube tu comprobante" }));
    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
    expect(paid).toHaveLength(0);
  });

  it("works from the keyboard alone: arrows change the choice, Enter confirms", async () => {
    const user = userEvent.setup();
    const paid = stub({
      link: linkWith({ payerReference: reference({ proven: true }), learnedBanks: ["AZTECA", "NUBANK"] }),
    });
    renderPage();
    await screen.findByRole("heading", { name: /haz tu transferencia/i });

    async function tabTo(match: (el: Element) => boolean) {
      for (let i = 0; i < 40; i++) {
        await user.tab();
        if (document.activeElement && match(document.activeElement)) return;
      }
      throw new Error("never reached by Tab");
    }
    const named = (name: string) => (el: Element) => el.textContent?.trim() === name;
    const radio = (label: string) => (el: Element) =>
      el instanceof HTMLInputElement && el.type === "radio" && el.closest("label")?.textContent?.includes(label) === true;

    await tabTo(named("Ya hice mi transferencia"));
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Confirma tu pago" });

    await tabTo(radio("Banco Azteca"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Nu" })).toBeChecked();

    await tabTo(radio("Hoy"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Ayer, lunes 28" })).toBeChecked();

    await tabTo(named("Confirmar pago"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({ transfer: { referenceSource: "own", senderBank: "NUBANK", date: "2026-09-28" } });
  });

  it("REFERENCE_NOT_READY falls back to today's receipt step, saying why", async () => {
    stub({
      link: linkWith({ payerReference: reference({ proven: true }) }),
      payAnswer: () => fail("REFERENCE_NOT_READY", 409),
    });
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));

    expect(await screen.findByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
    expect(screen.getByText(/por ahora no podemos buscar tu pago con tu referencia/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/captura o comprobante/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("TRANSFER_DATE_OUT_OF_RANGE is said on the day row", async () => {
    stub({
      link: linkWith({ payerReference: reference({ proven: true }) }),
      payAnswer: () => fail("TRANSFER_DATE_OUT_OF_RANGE", 409),
    });
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    expect(await screen.findByText("Elige un día de los últimos 30 días.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirma tu pago" })).toBeInTheDocument();
  });

  it("the five new refusals each have their page copy or behaviour", () => {
    /* A code added to the contract without a sentence here would reach
       the payer as the generic upload failure */
    expect([...PAY_REFUSALS_WITHOUT_RECEIPT].sort()).toEqual(
      [
        "CORRECTIONS_EXHAUSTED",
        "REFERENCE_NOT_READY",
        "REFERENCE_OF_ANOTHER",
        "SENDER_TAIL_NEEDED",
        "TRANSFER_DATE_OUT_OF_RANGE",
      ].sort(),
    );
  });
});

/* ======================================================================
   US3 — Devolada remembers how each customer pays
   ====================================================================== */

describe("payment-without-receipt US3: the banks it remembers", () => {
  it("the most recent learned bank is preselected, the others after it, then 'Otro banco'", async () => {
    const paid = stub({
      link: linkWith({ payerReference: reference({ proven: true }), learnedBanks: ["NUBANK", "AZTECA"] }),
    });
    renderPage();
    await openConfirmation();

    const bank = screen.getByRole("group", { name: "¿Desde qué banco pagaste?" });
    expect(within(bank).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "NuElegido",
      "Banco Azteca",
      "Otro banco",
    ]);
    /* the chosen one is marked by icon and word, not colour alone */
    expect(within(bank).getByRole("radio", { name: "Nu" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({ transfer: { senderBank: "NUBANK", preselected: { bank: "NUBANK" } } });
  });

  it("'Otro banco' lists this business's most used banks first, then the rest in es-MX order", async () => {
    stub({ link: linkWith({ payerReference: reference({ proven: true }) }) });
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("radio", { name: "Otro banco" }));

    const select = screen.getByLabelText("Elige tu banco");
    const offered = [...select.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(offered.slice(0, 3)).toEqual(["BBVA MEXICO", "AZTECA", "NUBANK"]);
    const rest = [...BANKS]
      .filter((b) => !["BBVA MEXICO", "AZTECA", "NUBANK"].includes(b))
      .sort((a, b) => a.localeCompare(b, "es-MX"));
    expect(offered.slice(3)).toEqual(rest);
    expect(offered).toHaveLength(BANKS.length);
    await expectNoViolations(document.body);
  });

  it("with no learned bank the list opens directly, and `preselected` says nothing was offered", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: true }), learnedBanks: [] }) });
    renderPage();
    await openConfirmation();

    expect(screen.queryByRole("group", { name: "¿Desde qué banco pagaste?" })).not.toBeInTheDocument();
    const select = screen.getByLabelText("¿Desde qué banco pagaste?");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("button", { name: /confirmar pago/i })).toBeDisabled();
    await userEvent.selectOptions(select, "BANORTE");
    expect(screen.getByText(/desde Banorte, hoy martes 29\.$/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({
      transfer: { senderBank: "BANORTE", preselected: { bank: null, day: "2026-09-29" } },
    });
  });
});

/* ======================================================================
   US4 — the read-back and the ladder
   ====================================================================== */

describe("payment-without-receipt US4: while it validates", () => {
  async function openData() {
    await userEvent.click(await screen.findByRole("button", { name: "Ver los datos que enviaste" }, { timeout: 8000 }));
  }

  it("reads back what is searched under 'Ver los datos que enviaste', with Corregir, and the wait breathes", async () => {
    /* validationAttempts 5 and not found: a receipt row would open the
       form now; a sourced row asks only by `ask` (D15) */
    stubInReview(sourced({ validationAttempts: 5, error: "TRANSFER_NOT_FOUND" }));
    renderPage();

    const waiting = await screen.findByText("Seguimos buscando tu transferencia en Banxico.", {}, { timeout: 8000 });
    await waitFor(() => expect(waiting.closest("[data-motion='breath']")).not.toBeNull());
    expect(screen.queryByLabelText("Clave de rastreo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Monto transferido")).not.toBeInTheDocument();

    await openData();
    for (const [label, value] of [
      ["Monto", "$514.00"],
      ["Referencia", "234 5678"],
      ["Banco", "Banco Azteca"],
      ["Día", "martes 29 de septiembre"],
    ]) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(screen.getByRole("button", { name: "Corregir" })).toBeInTheDocument();
    /* FR-019: no account, whole or in part */
    expect(screen.queryByText(/cuenta de origen|terminada en/i)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the read-back names every day the rounds searched, and the tail and clave the payer gave", async () => {
    stubInReview(
      sourced({
        referenceSource: "typed",
        referenceNumber: "9784417",
        senderTail: "8301",
        trackingKey: "HSBC712057",
        searchedDays: ["2026-09-29", "2026-09-28", "2026-09-30"],
      }),
    );
    renderPage();
    await openData();
    expect(screen.getByText("Días buscados").nextElementSibling).toHaveTextContent(
      "lunes 28, martes 29 y miércoles 30 de septiembre",
    );
    expect(screen.getByText("Últimos 4 dígitos de tu cuenta").nextElementSibling).toHaveTextContent("8301");
    expect(screen.getByText("Clave de rastreo").nextElementSibling).toHaveTextContent("HSBC712057");
  });

  it("Corregir re-sends with `supersedes`, keeping an own row own — no reference sent", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced(), paid);
    renderPage();
    await openData();
    await userEvent.click(screen.getByRole("button", { name: "Corregir" }));

    expect(screen.getByLabelText("Número de referencia")).toHaveValue("2345678");
    await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar estos datos" }));

    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: { referenceSource: "own", senderBank: "NUBANK", date: "2026-09-29", amountCents: 51400 },
      supersedes: "dp-1",
    });
  });

  it("a correction that changes the reference travels as typed", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced(), paid);
    renderPage();
    await openData();
    await userEvent.click(screen.getByRole("button", { name: "Corregir" }));
    const field = screen.getByLabelText("Número de referencia");
    await userEvent.clear(field);
    await userEvent.type(field, "9784417");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar estos datos" }));

    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({
      transfer: { referenceSource: "typed", referenceNumber: "9784417", senderBank: "AZTECA" },
      supersedes: "dp-1",
    });
  });

  it("check_data asks with the data open; 'Todo está bien' hides it with no call, and this device remembers", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced({ ask: "check_data", validationAttempts: 3 }), paid);
    renderPage();

    expect(
      await screen.findByText(
        "Todavía no encontramos tu transferencia. Revisa que estos datos sean los de tu app, y que hayas puesto la referencia 234 5678.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    /* the data are the question, so they are on screen, not behind a tap */
    expect(screen.getByText("Referencia").nextElementSibling).toHaveTextContent("234 5678");
    expect(screen.getByRole("button", { name: "Corregir" })).toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: "Todo está bien" }));
    expect(screen.queryByText(/todavía no encontramos tu transferencia/i)).not.toBeInTheDocument();
    expect(screen.getByText("Seguimos buscando tu transferencia en Banxico.")).toBeInTheDocument();
    expect(paid).toHaveLength(0);

    /* the next morning, on the same phone */
    cleanup();
    renderPage();
    expect(await screen.findByText("Seguimos buscando tu transferencia en Banxico.", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText(/todavía no encontramos tu transferencia/i)).not.toBeInTheDocument();
  });

  it("an unreadable memory means not acknowledged — the check is shown again", async () => {
    window.localStorage.setItem("devolada-pago-ask-ack", "{not json");
    stubInReview(sourced({ ask: "check_data" }));
    renderPage();
    expect(await screen.findByText(/todavía no encontramos tu transferencia/i, {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it("the clave ask focuses the clave, puts 'Sube tu comprobante' second, and sends today's door", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced({ ask: "clave", validationAttempts: 4 }), paid);
    renderPage();

    expect(
      await screen.findByText(
        "Para encontrarla con seguridad, escribe tu clave de rastreo. Puedes copiarla del detalle de la transferencia en tu app.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    const clave = screen.getByLabelText("Clave de rastreo");
    await waitFor(() => expect(clave).toHaveFocus());
    const send = screen.getByRole("button", { name: "Buscar con mi clave" });
    const receipt = screen.getByRole("button", { name: "Sube tu comprobante" });
    expect(send.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expectNoViolations(document.body);

    await userEvent.type(clave, "260929071144393084I");
    await userEvent.click(send);
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: { trackingKey: "260929071144393084I", senderBank: "AZTECA", date: "2026-09-29", amountCents: 51400 },
      supersedes: "dp-1",
    });
  });

  it("'Sube tu comprobante' from an ask is the receipt step, and the capture supersedes the row", async () => {
    stubInReview(sourced({ ask: "clave" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Sube tu comprobante" }, { timeout: 8000 }));
    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
  });

  it("with a provisional release standing, every ask says the service stays and what settles it", async () => {
    for (const ask of ["check_data", "clave", "sender_tail", "clave_tail"] as const) {
      stubInReview(
        sourced({
          ask,
          referenceSource: "typed",
          referenceNumber: "9784417",
          provisionalRelease: { evidence: "human", kind: "reconnect" },
        }),
      );
      renderPage();
      expect(
        await screen.findByText(
          "Tu servicio sigue activo. Tu clave o tu comprobante confirman el pago antes de que venza.",
          {},
          { timeout: 8000 },
        ),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("CORRECTIONS_EXHAUSTED: the clave and the receipt are what is left", async () => {
    stub({
      link: linkWith({ inReview: { directPaymentId: "dp-1", status: "validating" } }),
      status: sourced(),
      payAnswer: () => fail("CORRECTIONS_EXHAUSTED", 409),
    });
    renderPage();
    await openData();
    await userEvent.click(screen.getByRole("button", { name: "Corregir" }));
    await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar estos datos" }));

    expect(
      await screen.findByText(
        "Ya corregiste tus datos varias veces. Escribe tu clave de rastreo o sube tu comprobante.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Clave de rastreo")).toHaveFocus());
    expect(screen.queryByLabelText("Número de referencia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sube tu comprobante" })).toBeInTheDocument();
  });

  it("a used transfer names the payer's own payment with `usedBy`, and says today's sentence without it (D24)", async () => {
    stubInReview(
      sourced({
        status: "invalid",
        error: "TRANSFER_ALREADY_USED",
        usedBy: { day: "2026-09-12", amountCents: 35000 },
      }),
    );
    renderPage();
    expect(
      await screen.findByText("Ya se usó para tu pago del 12 de septiembre por $350.00.", {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    cleanup();

    stubInReview(sourced({ status: "invalid", error: "TRANSFER_ALREADY_USED", usedBy: null }));
    renderPage();
    expect(
      await screen.findByText("Esta transferencia ya fue utilizada para otro pago.", {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ya se usó para tu pago/i)).not.toBeInTheDocument();
  });

  it("an expired sourced row keeps the clave and the receipt, and offers no 'Reintentar ahora'", async () => {
    const paid: unknown[] = [];
    stubInReview(
      sourced({
        status: "expired",
        validationAttempts: 7,
        retryAvailable: true,
        trackingKey: "HSBC712057",
        provisionalRelease: { evidence: "human", kind: "reconnect" },
      }),
      paid,
    );
    renderPage();

    expect(await screen.findByText("Verificación expirada", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/escribe tu clave de rastreo o sube tu comprobante/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reintentar ahora/i })).not.toBeInTheDocument();
    const clave = screen.getByLabelText("Clave de rastreo");
    expect(screen.getByRole("button", { name: "Sube tu comprobante" })).toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.type(clave, "260929071144393084I");
    await userEvent.click(screen.getByRole("button", { name: "Buscar con mi clave" }));
    await waitFor(() => expect(paid).toHaveLength(1));
    /* a new payment: an expired row is final, nothing to supersede */
    expect(paid[0]).toEqual({
      transfer: { trackingKey: "260929071144393084I", senderBank: "AZTECA", date: "2026-09-29", amountCents: 51400 },
    });
  });
});

/* ======================================================================
   US5 — "No puse la referencia"
   ====================================================================== */

describe("payment-without-receipt US5: No puse la referencia", () => {
  async function openTyped() {
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: "No puse la referencia" }));
    await screen.findByRole("heading", { name: "No puse la referencia" });
  }

  it("offers the reference used or the clave, with 'Sube tu comprobante' second; a typed reference travels as typed", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: true }) }) });
    renderPage();
    await openTyped();

    const typedRef = screen.getByLabelText("Referencia que pusiste");
    expect(screen.getByLabelText("Clave de rastreo")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Buscar mi pago" });
    const receipt = screen.getByRole("button", { name: "Sube tu comprobante" });
    expect(send.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* D8: the day is bounded like the confirmation's */
    expect(screen.getByLabelText("Fecha de la transferencia")).toHaveAttribute("min", "2026-08-30");
    await expectNoViolations(document.body);

    /* Azteca's default — digits no person holds go on (D11, analysis I8):
       the clave is not demanded */
    await userEvent.type(typedRef, "7654321");
    await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "AZTECA");
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: {
        referenceSource: "typed",
        referenceNumber: "7654321",
        senderBank: "AZTECA",
        date: "2026-09-29",
        amountCents: 51400,
      },
    });
  });

  it("SENDER_TAIL_NEEDED shows the four-digit field and re-sends with it", async () => {
    const paid = stub({
      link: linkWith({ payerReference: reference({ proven: true }) }),
      payAnswer: (_, n) =>
        n === 1
          ? fail("SENDER_TAIL_NEEDED", 409)
          : ok(payResponse.parse({ directPaymentId: "dp-2", status: "validating", error: null }), 201),
    });
    renderPage();
    await openTyped();
    await userEvent.type(screen.getByLabelText("Referencia que pusiste"), "9784417");
    await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "AZTECA");
    await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));

    expect(
      await screen.findByText("Escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste."),
    ).toBeInTheDocument();
    const tail = screen.getByLabelText("Últimos 4 dígitos de tu cuenta o tarjeta");
    expect(screen.getByRole("button", { name: "Buscar mi pago" })).toBeDisabled();
    await userEvent.type(tail, "8301");
    await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));

    await waitFor(() => expect(paid).toHaveLength(2));
    expect(paid[1]).toMatchObject({
      transfer: { referenceSource: "typed", referenceNumber: "9784417", senderTail: "8301" },
    });
  });

  it("REFERENCE_OF_ANOTHER: said plainly, and only the clave is left beside the receipt; the clave is today's door", async () => {
    const paid = stub({
      link: linkWith({ payerReference: reference({ proven: true }) }),
      payAnswer: (_, n) =>
        n === 1
          ? fail("REFERENCE_OF_ANOTHER", 409)
          : ok(payResponse.parse({ directPaymentId: "dp-2", status: "validating", error: null }), 201),
    });
    renderPage();
    await openTyped();
    await userEvent.type(screen.getByLabelText("Referencia que pusiste"), "4029185");
    await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "AZTECA");
    await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));

    expect(
      await screen.findByText(
        "Esa referencia es de otra persona. Escribe tu clave de rastreo o sube tu comprobante.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Referencia que pusiste")).not.toBeInTheDocument();
    const clave = screen.getByLabelText("Clave de rastreo");
    await waitFor(() => expect(clave).toHaveFocus());
    expect(screen.getByRole("button", { name: "Sube tu comprobante" })).toBeInTheDocument();

    await userEvent.type(clave, "260929071144393084I");
    await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));
    await waitFor(() => expect(paid).toHaveLength(2));
    expect(paid[1]).toEqual({
      transfer: { trackingKey: "260929071144393084I", senderBank: "AZTECA", date: "2026-09-29", amountCents: 51400 },
    });
  });

  it("the sender_tail ask on a typed row re-sends the search with the digits", async () => {
    const paid: unknown[] = [];
    stubInReview(
      sourced({ ask: "sender_tail", referenceSource: "typed", referenceNumber: "7654321" }),
      paid,
    );
    renderPage();
    expect(
      await screen.findByText(
        "Esa referencia la usan otras personas. Escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    await expectNoViolations(document.body);
    const send = screen.getByRole("button", { name: "Enviar" });
    expect(send.compareDocumentPosition(screen.getByRole("button", { name: "Sube tu comprobante" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Últimos 4 dígitos de tu cuenta o tarjeta"), "8301");
    await userEvent.click(send);
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: {
        referenceSource: "typed",
        referenceNumber: "7654321",
        senderBank: "AZTECA",
        date: "2026-09-29",
        amountCents: 51400,
        senderTail: "8301",
      },
      supersedes: "dp-1",
    });
  });

  it("the sender_tail ask on an own row, during a reference's transition, says it is to confirm the transfer is theirs (D26)", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced({ ask: "sender_tail" }), paid);
    renderPage();
    expect(
      await screen.findByText(
        "Para confirmar que esta transferencia es tuya, escribe los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Últimos 4 dígitos de tu cuenta o tarjeta"), "8301");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: { referenceSource: "own", senderBank: "AZTECA", date: "2026-09-29", amountCents: 51400, senderTail: "8301" },
      supersedes: "dp-1",
    });
  });

  it("the clave_tail ask takes four characters, with 'Sube tu comprobante' second", async () => {
    const paid: unknown[] = [];
    stubInReview(
      sourced({ ask: "clave_tail", referenceSource: "typed", referenceNumber: "7654321", senderTail: "8301" }),
      paid,
    );
    renderPage();
    expect(
      await screen.findByText(
        "Encontramos más de una transferencia con esos datos. Escribe los últimos 4 caracteres de tu clave de rastreo.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    const field = screen.getByLabelText("Últimos 4 caracteres de tu clave de rastreo");
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole("button", { name: "Sube tu comprobante" })).toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.type(field, "084I");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: {
        referenceSource: "typed",
        referenceNumber: "7654321",
        senderBank: "AZTECA",
        date: "2026-09-29",
        amountCents: 51400,
        senderTail: "8301",
        claveTail: "084I",
      },
      supersedes: "dp-1",
    });
  });

  /* T055 (FR-040, FR-041): a phone beat this payer's assigned number */
  describe("a reference that changed", () => {
    const changed = () =>
      linkWith({ payerReference: reference({ digits: "4029185", fromPhone: false, previousDigits: "7815678" }) });

    it("step 1 and step 2 say it changed, and step 2 asks which one they put before anything else", async () => {
      stub({ link: changed() });
      renderPage();
      expect(
        await screen.findByText("Tu referencia cambió: ahora es 402 9185. Actualiza el contacto en tu banco."),
      ).toBeInTheDocument();
      await goToStep2();

      expect(
        screen.getByText("Tu referencia cambió: ahora es 402 9185. Actualiza el contacto en tu banco."),
      ).toBeInTheDocument();
      const which = screen.getByRole("group", { name: "¿Qué referencia pusiste en tu transferencia?" });
      expect(within(which).getByRole("radio", { name: "402 9185, la nueva" })).not.toBeChecked();
      expect(within(which).getByRole("radio", { name: "781 5678, la anterior" })).not.toBeChecked();
      /* nothing else until it is answered — and the first-time question
         is not asked on top of it */
      expect(screen.queryByRole("button", { name: /confirmar pago/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/¿pusiste la referencia/i)).not.toBeInTheDocument();
      await expectNoViolations(document.body);
    });

    it("the new one confirms as their own; the previous one travels typed, with those digits", async () => {
      const paid = stub({ link: changed() });
      renderPage();
      await goToStep2();

      await userEvent.click(screen.getByRole("radio", { name: "402 9185, la nueva" }));
      expect(screen.getByText(/con la referencia 402 9185, desde Banco Azteca/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
      await waitFor(() => expect(paid).toHaveLength(1));
      expect(paid[0]).toEqual({
        transfer: {
          referenceSource: "own",
          senderBank: "AZTECA",
          date: "2026-09-29",
          preselected: { bank: "AZTECA", day: "2026-09-29" },
        },
      });
      cleanup();
      window.localStorage.clear();

      const paid2 = stub({ link: changed() });
      renderPage();
      await goToStep2();
      await userEvent.click(screen.getByRole("radio", { name: "781 5678, la anterior" }));
      expect(screen.getByText(/con la referencia 781 5678, desde Banco Azteca/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
      await waitFor(() => expect(paid2).toHaveLength(1));
      expect(paid2[0]).toEqual({
        transfer: {
          referenceSource: "typed",
          referenceNumber: "7815678",
          senderBank: "AZTECA",
          date: "2026-09-29",
          preselected: { bank: "AZTECA", day: "2026-09-29" },
        },
      });
    });

    it("the previous one, answered SENDER_TAIL_NEEDED, asks the four digits on the same screen (FR-041)", async () => {
      const paid = stub({
        link: changed(),
        payAnswer: (_, n) =>
          n === 1
            ? fail("SENDER_TAIL_NEEDED", 409)
            : ok(payResponse.parse({ directPaymentId: "dp-2", status: "validating", error: null }), 201),
      });
      renderPage();
      await goToStep2();
      await userEvent.click(screen.getByRole("radio", { name: "781 5678, la anterior" }));
      await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));

      const tail = await screen.findByLabelText("Últimos 4 dígitos de tu cuenta o tarjeta");
      expect(screen.getByRole("button", { name: /confirmar pago/i })).toBeDisabled();
      await userEvent.type(tail, "8301");
      await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
      await waitFor(() => expect(paid).toHaveLength(2));
      expect(paid[1]).toMatchObject({
        transfer: { referenceSource: "typed", referenceNumber: "7815678", senderTail: "8301" },
      });
    });
  });
});
