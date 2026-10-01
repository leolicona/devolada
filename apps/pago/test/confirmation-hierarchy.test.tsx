import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import {
  BANKS,
  directPaymentStatusResponse,
  linkStatusResponse,
  payRequest,
  payResponse,
} from "@devolada/api/direct-payments-schema";
import { App, queryClient } from "../src/App";
import { fail, handlers, ok, server } from "./msw";
import { expectNoViolations } from "./a11y";

/* specs/017-confirmation-hierarchy — the payer's page (contracts/
   payment-page.md): the three ways to confirm in their order and the quiet
   receipt link (confirmation-hierarchy US1), the tie-break screen (US2),
   the payer's vocabulary (US4), and proposal E (US5).

   Every fixture is parsed by the contract the API exports, and every body
   the page sends is parsed by `payRequest`. */

beforeEach(() => {
  window.localStorage.clear();
  /* Tuesday 29 September 2026, 21:00 in Mexico City — already the 30th in
     UTC (the payment-without-receipt suite's clock). Only `Date` is faked. */
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/* A second scenario inside one test starts from empty too: the query
   cache lives on the module, not on the tree */
function fresh() {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
}

function renderPage(path = "/p/tok123") {
  window.history.pushState({}, "", path);
  render(<App />);
}

const reference = (over: Record<string, unknown> = {}) => ({
  digits: "2345678",
  fromPhone: true,
  proven: true,
  previousDigits: null,
  ...over,
});

const baseLink = {
  ispName: "Gimnasio Norte",
  customerName: "Janely",
  status: "debt",
  invoiceCents: 49900,
  carriedBalanceCents: 0,
  serviceFeeCents: 1500,
  totalCents: 51400,
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "Gimnasio Norte SA de CV",
  reference: "socio-0042",
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
    referenceNumber: "9784417",
    referenceSource: "typed",
    senderTail: null,
    searchedDays: ["2026-09-29"],
    ask: null,
    tieBreak: null,
    usedBy: null,
    ...over,
  });

const TIE_BOTH = { ways: ["sender_tail", "clave_tail"], missed: false, several: true };

function stub({
  link = linkWith(),
  paid = [],
  payAnswer,
  status = sourced(),
  statusReads,
}: {
  link?: unknown | (() => unknown);
  paid?: unknown[];
  payAnswer?: (body: unknown, n: number) => ReturnType<typeof ok | typeof fail>;
  status?: unknown | (() => unknown);
  statusReads?: { n: number };
} = {}) {
  server.use(
    handlers.link(() => ok(typeof link === "function" ? (link as () => unknown)() : link)),
    handlers.pay((body) => {
      payRequest.parse(body);
      paid.push(body);
      return (
        payAnswer?.(body, paid.length) ??
        ok(payResponse.parse({ directPaymentId: `dp-${paid.length + 1}`, status: "validating", error: null }), 201)
      );
    }),
    handlers.status(() => {
      if (statusReads) statusReads.n += 1;
      return ok(typeof status === "function" ? (status as () => unknown)() : status);
    }),
  );
  return paid;
}

/* A payer coming back to the attempt still in review */
function stubInReview(status: unknown, paid: unknown[] = [], over: Record<string, unknown> = {}) {
  return stub({ link: linkWith({ inReview: { directPaymentId: "dp-1", status: "validating" }, ...over }), paid, status });
}

async function goToStep2() {
  await userEvent.click(await screen.findByRole("button", { name: /ya hice mi transferencia/i }));
}

async function openConfirmation() {
  await goToStep2();
  await screen.findByRole("heading", { name: "Confirma tu pago" });
}

const RECEIPT = "Subir foto del comprobante";

/* the view's last action is the quiet receipt link */
function receiptIsLast() {
  const buttons = screen.getAllByRole("button");
  const last = buttons[buttons.length - 1];
  expect(last).toHaveTextContent(RECEIPT);
  /* D2: today's quiet door recipe — ghost, 48px, small text, full width */
  expect(last.className).toMatch(/\bh-12\b/);
  expect(last.className).toMatch(/\btext-sm\b/);
  expect(last.className).toMatch(/\bw-full\b/);
  expect(last.className).not.toMatch(/\bborder\b/);
}

/* nothing on the page still says 012's two exits or "genérica" */
function noOldExits() {
  expect(screen.queryByText(/sube tu comprobante$/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sube tu comprobante" })).not.toBeInTheDocument();
  expect(screen.queryByText(/no puse la referencia/i)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/genérica/i);
}

/* ======================================================================
   US1 — three ways to confirm, in a fixed order
   ====================================================================== */

describe("confirmation-hierarchy US1: three ways to confirm, in a fixed order (T008, D2, D3)", () => {
  it("the confirmation: bank, day, read-back, 'Pagué otra cantidad', Confirmar pago, Usé otra referencia, the receipt link — one decisive button", async () => {
    stub();
    renderPage();
    await openConfirmation();

    const order = [
      screen.getByRole("group", { name: "¿Desde qué banco pagaste?" }),
      screen.getByRole("group", { name: "¿Qué día?" }),
      screen.getByText(/^Buscaremos \$514\.00 con la referencia/),
      screen.getByRole("button", { name: "Pagué otra cantidad" }),
      screen.getByRole("button", { name: /confirmar pago/i }),
      screen.getByRole("button", { name: "Usé otra referencia" }),
      screen.getByRole("button", { name: RECEIPT }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    /* FR-002: the only decisive-size action of the step */
    expect(screen.getAllByRole("button").filter((b) => /\bh-16\b/.test(b.className))).toHaveLength(1);
    expect(screen.getByRole("button", { name: /confirmar pago/i }).className).toMatch(/\bh-16\b/);
    /* FR-003: option 2 is a standard secondary control */
    const other = screen.getByRole("button", { name: "Usé otra referencia" });
    expect(other.className).toMatch(/\bh-12\b/);
    expect(other.className).toMatch(/\bborder\b/);
    receiptIsLast();
    noOldExits();
    await expectNoViolations(document.body);
  });

  it("'Usé otra referencia' opens one form, Volver and the receipt link last; Volver comes back and nothing was sent", async () => {
    const paid = stub();
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: "Usé otra referencia" }));

    expect(screen.getByRole("heading", { name: "Usé otra referencia" })).toBeInTheDocument();
    expect(screen.getByText("Escribe la referencia que usaste o tu clave de rastreo. Con una basta.")).toBeInTheDocument();
    expect(screen.getByLabelText("Referencia que usaste")).toBeInTheDocument();
    expect(screen.getByLabelText("Clave de rastreo")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: /^volver$/i });
    expect(back.compareDocumentPosition(screen.getByRole("button", { name: RECEIPT })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    receiptIsLast();
    noOldExits();
    await expectNoViolations(document.body);

    await userEvent.click(back);
    expect(await screen.findByRole("heading", { name: "Confirma tu pago" })).toBeInTheDocument();
    expect(paid).toHaveLength(0);
  });

  it("the receipt link opens today's capture guide and upload, with Volver back to the confirmation", async () => {
    const paid = stub();
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: RECEIPT }));

    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/captura o comprobante/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /no tengo el comprobante a la mano/i })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
    await userEvent.click(screen.getByRole("button", { name: /^volver$/i }));
    expect(await screen.findByRole("heading", { name: "Confirma tu pago" })).toBeInTheDocument();
    expect(paid).toHaveLength(0);
  });

  it("*No* to '¿Pusiste la referencia…?' opens option 2 with no request; a remount lands on the confirmation", async () => {
    const paid = stub({ link: linkWith({ payerReference: reference({ proven: false }) }) });
    renderPage();
    await goToStep2();
    /* on the question, *No* is option 2, and the receipt is still last */
    receiptIsLast();
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("heading", { name: "Usé otra referencia" })).toBeInTheDocument();
    expect(paid).toHaveLength(0);

    /* D3: the view is page state — a reload (the device's step kept)
       lands on the confirmation */
    cleanup();
    queryClient.clear();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Confirma tu pago" })).toBeInTheDocument();
  });

  it.each([
    ["check_data", sourced({ ask: "check_data", validationAttempts: 3 })],
    ["clave", sourced({ ask: "clave", validationAttempts: 4 })],
    ["tie_break", sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" })],
    ["'Ya se usó para…' while validating", sourced({ referenceSource: "own", error: "CEP_ALL_USED", usedBy: { day: "2026-09-12", amountCents: 35000 } })],
    ["'Ya se usó para…' refused", sourced({ status: "invalid", error: "TRANSFER_ALREADY_USED", usedBy: { day: "2026-09-12", amountCents: 35000 } })],
    ["the expired view", sourced({ status: "expired", validationAttempts: 7, error: "TRANSFER_NOT_FOUND" })],
  ])("the receipt link is the last action of the %s view", async (_view, status) => {
    stubInReview(status);
    renderPage();
    await screen.findByRole("button", { name: RECEIPT }, { timeout: 8000 });
    receiptIsLast();
    noOldExits();
    await expectNoViolations(document.body);
  });

  it("the plain wait of the first rounds shows no receipt link (FR-005)", async () => {
    stubInReview(sourced({ referenceSource: "own", referenceNumber: "2345678" }));
    renderPage();
    expect(await screen.findByText("Seguimos buscando tu transferencia.", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIPT })).not.toBeInTheDocument();
    noOldExits();
  });

  it.each([
    ["REFERENCE_OF_ANOTHER", "typed"],
    ["TRANSFER_DATE_OUT_OF_RANGE", "confirm"],
  ] as const)("the refusal %s ends with the receipt link", async (code, view) => {
    stub({ payAnswer: () => fail(code, 409) });
    renderPage();
    await openConfirmation();
    if (view === "typed") {
      await userEvent.click(screen.getByRole("button", { name: "Usé otra referencia" }));
      await userEvent.type(screen.getByLabelText("Referencia que usaste"), "4029185");
      await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));
    } else {
      await userEvent.click(screen.getByRole("button", { name: /confirmar pago/i }));
    }
    await screen.findByRole("alert");
    receiptIsLast();
    await expectNoViolations(document.body);
  });

  it.each(["CORRECTIONS_EXHAUSTED", "TIE_BREAK_EXHAUSTED"])("the refusal %s ends with the receipt link", async (code) => {
    stub({
      link: linkWith({ inReview: { directPaymentId: "dp-1", status: "validating" } }),
      status: code === "TIE_BREAK_EXHAUSTED" ? sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" }) : sourced(),
      payAnswer: () => fail(code, 409),
    });
    renderPage();
    if (code === "TIE_BREAK_EXHAUSTED") {
      await userEvent.type(
        await screen.findByLabelText("Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste", {}, { timeout: 8000 }),
        "1111",
      );
      await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    } else {
      await userEvent.click(await screen.findByRole("button", { name: "Ver los datos que enviaste" }, { timeout: 8000 }));
      await userEvent.click(screen.getByRole("button", { name: "Corregir" }));
      await userEvent.selectOptions(screen.getByLabelText("Banco desde el que pagaste"), "NUBANK");
      await userEvent.click(screen.getByRole("button", { name: "Confirmar estos datos" }));
    }
    await waitFor(() => expect(screen.getByLabelText("Clave de rastreo")).toBeInTheDocument());
    receiptIsLast();
  });

  it("a link without a reference keeps today's step: the capture first, 'No tengo el comprobante a la mano'", async () => {
    stub({ link: linkStatusResponse.parse({ ...baseLink, payerReference: null }) });
    renderPage();
    await goToStep2();
    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no tengo el comprobante a la mano/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIPT })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usé otra referencia" })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

/* ======================================================================
   US2 — the tie-break screen
   ====================================================================== */

describe("confirmation-hierarchy US2: the tie-break screen (T015, D9, D12)", () => {
  it("both ways, 'o' between them, opening by `several`, nothing pre-filled, Confirmar only with a field complete", async () => {
    const paid: unknown[] = [];
    stubInReview(sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" }), paid);
    renderPage();
    expect(
      await screen.findByText(
        "Encontramos más de una transferencia con esos datos. Para saber cuál es la tuya, escribe uno de estos datos. Con uno basta.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    const digits = screen.getByLabelText("Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste");
    const chars = screen.getByLabelText("Últimos 4 caracteres de tu clave de rastreo");
    expect(digits).toHaveValue("");
    expect(chars).toHaveValue("");
    expect(digits).toHaveAttribute("inputmode", "numeric");
    expect(digits.compareDocumentPosition(screen.getByText("o")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const send = screen.getByRole("button", { name: "Confirmar" });
    expect(send).toBeDisabled();
    await userEvent.type(digits, "830");
    expect(send).toBeDisabled();
    await userEvent.type(chars, "o4");
    expect(chars).toHaveValue("O4");
    await userEvent.type(digits, "1");
    expect(send).toBeEnabled();
    receiptIsLast();
    await expectNoViolations(document.body);

    await userEvent.click(send);
    await waitFor(() => expect(paid).toHaveLength(1));
    /* the waiting row's search, the tail typed, `supersedes` — the
       incomplete characters are not sent */
    expect(paid[0]).toEqual({
      transfer: {
        referenceSource: "typed",
        referenceNumber: "9784417",
        senderBank: "AZTECA",
        date: "2026-09-29",
        amountCents: 51400,
        senderTail: "8301",
      },
      supersedes: "dp-1",
    });
  });

  it("one transfer found opens on it; the characters only, with their sentence; the digits only, with 'Escribe también…'", async () => {
    stubInReview(sourced({ ask: "tie_break", tieBreak: { ...TIE_BOTH, several: false }, error: "CEP_UNDECIDED" }));
    renderPage();
    expect(
      await screen.findByText(
        "Encontramos una transferencia con esos datos. Para confirmar que es tuya, escribe uno de estos datos. Con uno basta.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    fresh();

    stubInReview(sourced({ ask: "tie_break", tieBreak: { ways: ["clave_tail"], missed: false, several: true }, error: "CEP_UNDECIDED" }));
    renderPage();
    expect(
      await screen.findByText(
        "Para confirmar que esta transferencia es tuya, escribe los últimos 4 caracteres de tu clave de rastreo.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/últimos 4 dígitos/i)).not.toBeInTheDocument();
    expect(screen.queryByText("o")).not.toBeInTheDocument();
    fresh();

    stubInReview(sourced({ ask: "tie_break", tieBreak: { ways: ["sender_tail"], missed: false, several: true }, error: "CEP_UNDECIDED" }));
    renderPage();
    expect(
      await screen.findByText("Escribe también los últimos 4 dígitos de la cuenta o tarjeta con la que pagaste.", {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/últimos 4 caracteres/i)).not.toBeInTheDocument();
  });

  it("a miss says so in an Alert with an icon and text, and asks again", async () => {
    stubInReview(sourced({ ask: "tie_break", tieBreak: { ...TIE_BOTH, missed: true }, error: "CEP_UNDECIDED", senderTail: "9999" }));
    renderPage();
    const miss = await screen.findByText(/Ese dato no coincide con ninguna de las transferencias que encontramos\./, {}, { timeout: 8000 });
    const alert = miss.closest("[role='status'], [role='alert']") ?? miss.parentElement!;
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(screen.getByLabelText("Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste")).toHaveValue("");
    await expectNoViolations(document.body);
  });

  it("TIE_BREAK_EXHAUSTED shows 012's clave ask, the receipt link last", async () => {
    stub({
      link: linkWith({ inReview: { directPaymentId: "dp-1", status: "validating" } }),
      status: sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" }),
      payAnswer: () => fail("TIE_BREAK_EXHAUSTED", 409),
    });
    renderPage();
    await userEvent.type(
      await screen.findByLabelText("Últimos 4 caracteres de tu clave de rastreo", {}, { timeout: 8000 }),
      "ZZZZ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(
      await screen.findByText(
        "Para encontrarla con seguridad, escribe tu clave de rastreo. Puedes copiarla del detalle de la transferencia en tu app.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Clave de rastreo")).toHaveFocus());
    expect(screen.queryByLabelText(/últimos 4 caracteres/i)).not.toBeInTheDocument();
    receiptIsLast();
  });

  it("ask: clave (the link's limit) is 012's clave ask, the receipt link last", async () => {
    stubInReview(sourced({ ask: "clave", error: "CEP_UNDECIDED" }));
    renderPage();
    expect(
      await screen.findByText(/Para encontrarla con seguridad, escribe tu clave de rastreo\./, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    receiptIsLast();
  });

  it("TIE_BREAK_NOT_ASKED re-reads the status and shows no error; another tab's answer is followed", async () => {
    const statusReads = { n: 0 };
    let answered = false;
    stub({
      link: () =>
        linkWith({ inReview: { directPaymentId: answered ? "dp-9" : "dp-1", status: "validating" } }),
      status: () =>
        answered
          ? sourced({ status: "superseded" })
          : sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" }),
      statusReads,
      payAnswer: () => {
        answered = true;
        return fail("TIE_BREAK_NOT_ASKED", 409);
      },
    });
    server.use(
      http.get("/direct-payments/dp-9/status", () =>
        HttpResponse.json({ success: true, data: sourced({ status: "confirmed", folio: "DV-TAB2" }) }),
      ),
    );
    renderPage();
    await userEvent.type(
      await screen.findByLabelText("Últimos 4 dígitos de la cuenta o tarjeta con la que pagaste", {}, { timeout: 8000 }),
      "4417",
    );
    const before = statusReads.n;
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(statusReads.n).toBeGreaterThan(before));
    expect(await screen.findByText("Folio DV-TAB2", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/* ======================================================================
   US4 — the payer reads about their transfer, never about who checks it
   ====================================================================== */

/* A receipt payment of a business without the feature (the copy is the
   page's on every business) */
const receiptRow = (over: Record<string, unknown> = {}) =>
  directPaymentStatusResponse.parse({
    status: "validating",
    validationAttempts: 2,
    nextValidationAt: null,
    error: "TRANSFER_NOT_FOUND",
    trackingKey: "HSBC712057",
    senderBank: "AZTECA",
    transferDate: "2026-09-29",
    claimedAmountCents: 51400,
    readingCheck: null,
    receiptStatus: null,
    ...over,
  });

describe("confirmation-hierarchy US4: the payer's vocabulary (T026, D13, D14, D15)", () => {
  const plain = linkStatusResponse.parse({ ...baseLink, payerReference: null, inReview: { directPaymentId: "dp-1", status: "validating" } });

  it("the default wait: 'Seguimos buscando tu transferencia.' and 'Todavía no la vemos'", async () => {
    stub({ link: plain, status: receiptRow() });
    renderPage();
    expect(
      await screen.findByText(/^Seguimos buscando tu transferencia\. Todavía no la vemos\./, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/banxico|internet/i);
    await expectNoViolations(document.body);
  });

  it("a release after agreement: 'Tu servicio ya volvió mientras terminamos de confirmar tu transferencia'", async () => {
    stub({
      link: plain,
      status: receiptRow({ readingCheck: "agreed", provisionalRelease: { evidence: "agreed", kind: "reconnect" } }),
    });
    renderPage();
    expect(
      await screen.findByText(/Tu servicio ya volvió mientras terminamos de confirmar tu transferencia/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/banxico|internet/i);
  });

  it("an expired row: 'No pudimos confirmar tu transferencia a tiempo', and the business by its name", async () => {
    stub({ link: plain, status: receiptRow({ status: "expired", validationAttempts: 7 }) });
    renderPage();
    expect(
      await screen.findByText(/No pudimos confirmar tu transferencia a tiempo\. Si ya la hiciste, contacta a Gimnasio Norte con tu comprobante/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/banxico|internet|proveedor de/i);
  });

  it("a link that does not exist sends the payer to whoever sent it", async () => {
    server.use(handlers.link(() => fail("NOT_FOUND", 404)));
    renderPage();
    expect(await screen.findByText("Este link de pago no existe. Pide el link correcto a quien te lo envió.")).toBeInTheDocument();
  });

  it("no saved link: 'Tu pago', and 'a quien te envió el link'", async () => {
    renderPage("/");
    expect(await screen.findByRole("heading", { name: "Tu pago" })).toBeInTheDocument();
    expect(screen.getByText(/a quien te envió el link/)).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the payer's bank lists — the typed form's and 'Otro banco' — have no Banxico", { timeout: 15000 }, async () => {
    stub({ link: linkStatusResponse.parse({ ...baseLink, payerReference: null }) });
    renderPage();
    await goToStep2();
    await userEvent.click(screen.getByRole("button", { name: /no tengo el comprobante a la mano/i }));
    const typedBanks = [...screen.getByLabelText("Banco desde el que pagaste").querySelectorAll("option")].map((o) => o.value);
    expect(typedBanks.some((b) => /banxico/i.test(b))).toBe(false);
    expect(typedBanks.filter(Boolean)).toHaveLength(BANKS.length - 1);
    fresh();

    stub();
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("radio", { name: "Otro banco" }));
    const otherBanks = [...screen.getByLabelText("Elige tu banco").querySelectorAll("option")].map((o) => o.value);
    expect(otherBanks.some((b) => /banxico/i.test(b))).toBe(false);
    await expectNoViolations(document.body);
  });
});

/* ======================================================================
   US5 — proposal E
   ====================================================================== */

describe("confirmation-hierarchy US5: step 1 shows where to pay and the payer's reference first (T039, D19, D20)", () => {
  it.each([
    ["clabe", "646180157000000004", "STP", "CLABE", "Cuenta CLABE", /Gimnasio Norte recibe sus pagos en esta CLABE\. El dinero llega directo a su cuenta\./],
    ["card", "4152313412345678", "BBVA MEXICO", "Tarjeta de débito", "Número de tarjeta", /Gimnasio Norte recibe sus pagos en esta tarjeta\. Elige «Tarjeta de débito»/],
    ["phone", "5512345678", "NU MEXICO", "Celular", "Número de celular", /Gimnasio Norte recibe sus pagos en este celular\. Elige «Celular»/],
  ] as const)("%s: the tag, the number with its copy button, the bank beside a card or a phone, the line by the business's name", async (kind, value, bank, tag, field, line) => {
    stub({ link: linkWith({ collectAccount: { kind, value, bank } }) });
    renderPage();
    const where = await screen.findByRole("region", { name: "Transfiere a" });
    expect(within(where).getAllByText(tag).length).toBeGreaterThan(0);
    expect(within(where).getByText(value)).toBeInTheDocument();
    expect(within(where).getByRole("button", { name: `Copiar ${tag}` })).toBeInTheDocument();
    if (kind === "clabe") expect(within(where).queryByText("Banco", { selector: "p" })).not.toBeInTheDocument();
    else {
      expect(within(where).getByText("Banco", { selector: "p" })).toBeInTheDocument();
      expect(within(where).getByText(bank)).toBeInTheDocument();
      expect(within(where).getByText("Tu app te lo pide junto al número")).toBeInTheDocument();
    }
    expect(within(where).getByText(line)).toBeInTheDocument();

    /* the reference's box comes after the account and before the example */
    const box = screen.getByRole("region", { name: "Tu referencia" });
    const example = screen.getByRole("region", { name: "Así se llena en tu app" });
    expect(where.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(example).getByText(field)).toBeInTheDocument();
    expect(within(example).getByText(value)).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the reference's box: 'Solo tuya', the grouped digits, a copy that writes seven, the phone's note, where it goes and why", async () => {
    const user = userEvent.setup();
    stub();
    renderPage();
    const box = await screen.findByRole("region", { name: "Tu referencia" });
    expect(within(box).getByText("Solo tuya")).toBeInTheDocument();
    expect(within(box).getByText("234 5678")).toBeInTheDocument();
    expect(within(box).getByText("Son los últimos 7 números de tu celular.")).toBeInTheDocument();
    expect(within(box).getByText("Escríbela en «Referencia numérica», no en «Concepto».")).toBeInTheDocument();
    expect(within(box).getByText("Con ella reconocemos tu transferencia: no tendrás que mandar comprobante.")).toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Copiar Tu referencia" }));
    expect(await navigator.clipboard.readText()).toBe("2345678");
    expect(within(box).getByRole("button", { name: /Copiada/ })).toBeInTheDocument();
    fresh();

    stub({ link: linkWith({ payerReference: reference({ digits: "7812044", fromPhone: false }) }) });
    renderPage();
    const assigned = await screen.findByRole("region", { name: "Tu referencia" });
    expect(within(assigned).getByText("Solo tuya")).toBeInTheDocument();
    expect(within(assigned).queryByText(/últimos 7 números de tu celular/i)).not.toBeInTheDocument();
  });

  it("the example holds its four rows, the reference's marked; 'Ver otra vez' plays it again", async () => {
    stub();
    renderPage();
    const example = await screen.findByRole("region", { name: "Así se llena en tu app" });
    const rows = within(example).getAllByRole("term").map((t) => t.textContent);
    expect(rows).toEqual(["Cuenta CLABE", "Monto", "Referencia numéricaTu referencia", "Concepto"]);
    expect(within(example).getByText("$514.00")).toBeInTheDocument();
    expect(within(example).getByText("Opcional: lo que quieras")).toBeInTheDocument();
    expect(within(example).getByText("234 5678").closest(".example-reference")).not.toBeNull();
    expect(screen.getByText("Los nombres cambian un poco según tu banco. La referencia siempre va en el campo de números.")).toBeInTheDocument();
    const list = example.querySelector("dl")!;
    await userEvent.click(within(example).getByRole("button", { name: "Ver otra vez" }));
    /* remounted by key: a new list, the motion played again */
    expect(example.querySelector("dl")).not.toBe(list);
    expect(example.querySelector("dl")!.getAttribute("data-example-run")).toBe("1");
  });

  it("without a reference, step 1 is today's", async () => {
    stub({ link: linkStatusResponse.parse({ ...baseLink, payerReference: null }) });
    renderPage();
    await screen.findByRole("heading", { name: /haz tu transferencia/i });
    expect(screen.queryByRole("region", { name: "Tu referencia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Así se llena en tu app" })).not.toBeInTheDocument();
    expect(screen.getByText("Al terminar, toma captura del detalle")).toBeInTheDocument();
  });
});

describe("confirmation-hierarchy US5: step 2 and after (T040, D18, D21, D22)", () => {
  it("the bank and the day are native radios drawn as chips: one checked, the arrow keys move it, one tab stop per group", async () => {
    const user = userEvent.setup();
    stub({ link: linkWith({ learnedBanks: ["AZTECA", "NUBANK"] }) });
    renderPage();
    await openConfirmation();
    const bank = screen.getByRole("group", { name: "¿Desde qué banco pagaste?" });
    const radios = within(bank).getAllByRole("radio");
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
    expect(radios[0].closest("label")!.className).toMatch(/rounded-full/);
    expect(radios[0].closest("label")!.className).toMatch(/min-h-12/);

    for (let i = 0; i < 20 && document.activeElement !== radios[0]; i++) await user.tab();
    expect(radios[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(bank).getByRole("radio", { name: "Nu" })).toBeChecked();
    /* one Tab stop: the next Tab leaves the group */
    await user.tab();
    expect(bank.contains(document.activeElement)).toBe(false);
    expect(screen.getByText("Elegimos el banco de tu último pago. Cámbialo si pagaste desde otro.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the preselected-bank line only when a learned bank was preselected", async () => {
    stub({ link: linkWith({ learnedBanks: [] }) });
    renderPage();
    await openConfirmation();
    expect(screen.queryByText(/elegimos el banco de tu último pago/i)).not.toBeInTheDocument();
  });

  it("'¿Por qué te preguntamos esto?' opens one sentence in place, and nothing is sent", async () => {
    const paid = stub();
    renderPage();
    await openConfirmation();
    const why = screen.getByRole("button", { name: "¿Por qué te preguntamos esto?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    expect(why.className).toMatch(/\bh-12\b/);
    await userEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "Tu referencia, el banco y el día nos bastan para encontrar tu transferencia entre todas las de ese día. Por eso no te pedimos comprobante.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "false");
    expect(paid).toHaveLength(0);
  });

  it("option 2 shows the confirmation's choices as tags and sends them unchanged", async () => {
    const paid = stub();
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("radio", { name: "Ayer · lun 28" }));
    await userEvent.click(screen.getByRole("button", { name: "Pagué otra cantidad" }));
    const amount = screen.getByLabelText("Monto que transferiste");
    await userEvent.clear(amount);
    await userEvent.type(amount, "300");
    await userEvent.click(screen.getByRole("button", { name: "Usé otra referencia" }));

    const tags = within(screen.getByRole("list", { name: "Con lo que ya elegiste" })).getAllByRole("listitem").map((t) => t.textContent);
    expect(tags).toEqual(["$300.00", "Banco Azteca", "Ayer · lun 28"]);
    await userEvent.type(screen.getByLabelText("Referencia que usaste"), "9784417");
    await userEvent.click(screen.getByRole("button", { name: "Buscar mi pago" }));
    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({
      transfer: { referenceSource: "typed", referenceNumber: "9784417", senderBank: "AZTECA", date: "2026-09-28", amountCents: 30000 },
    });

    /* Volver finds the choices as they were */
  });

  it("'Otro banco' with none picked: the tag says 'Elige tu banco' and 'Buscar mi pago' waits; Volver keeps the choices", async () => {
    stub();
    renderPage();
    await openConfirmation();
    await userEvent.click(screen.getByRole("radio", { name: "Otro banco" }));
    await userEvent.click(screen.getByRole("button", { name: "Usé otra referencia" }));
    expect(within(screen.getByRole("list", { name: "Con lo que ya elegiste" })).getByText("Elige tu banco")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Referencia que usaste"), "9784417");
    expect(screen.getByRole("button", { name: "Buscar mi pago" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^volver$/i }));
    expect(await screen.findByRole("radio", { name: "Otro banco" })).toBeChecked();
  });

  it("the plain wait lists the three steps, the second current, and no receipt link", async () => {
    stubInReview(sourced({ referenceSource: "own", referenceNumber: "2345678" }));
    renderPage();
    const steps = await screen.findByRole("list", { name: "Así va tu pago" }, { timeout: 8000 });
    const items = within(steps).getAllByRole("listitem");
    expect(items.map((i) => i.querySelector("p")!.textContent)).toEqual([
      "Recibimos tus datos",
      "Verificamos tu transferencia",
      "Confirmamos tu pago",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(within(items[2]).getByText("Y Gimnasio Norte lo registra")).toBeInTheDocument();
    expect(screen.getByText("Suele tomar menos de un minuto. Puedes cerrar esta página y volver después.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RECEIPT })).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("the tie-break's illustration holds placeholders only — no digit, no character of a transfer", async () => {
    stubInReview(sourced({ ask: "tie_break", tieBreak: TIE_BOTH, error: "CEP_UNDECIDED" }));
    renderPage();
    const figure = await screen.findByRole("figure", { name: "Búscalos en el detalle de tu transferencia:" }, { timeout: 8000 });
    expect(within(figure).getByText("Cuenta de origen")).toBeInTheDocument();
    expect(within(figure).getByText("Clave de rastreo")).toBeInTheDocument();
    expect(within(figure).getByText("4 dígitos")).toBeInTheDocument();
    expect(within(figure).getByText("4 caracteres")).toBeInTheDocument();
    /* the only digit in it is the count, "4" */
    expect(figure.textContent!.replace(/4 dígitos|4 caracteres/g, "")).not.toMatch(/\d/);
  });

  it("a confirmed own row ends with next month; a confirmed typed row does not", async () => {
    stubInReview(sourced({ status: "confirmed", referenceSource: "own", referenceNumber: "2345678", folio: "DV-OWN" }));
    renderPage();
    expect(await screen.findByText("Folio DV-OWN", {}, { timeout: 8000 })).toBeInTheDocument();
    /* the no-break space inside the digits reads as a space here */
    const line = screen.getByText(/Usa la misma referencia, 234 5678, y confirmas tu pago en dos toques\./);
    expect(line).toHaveTextContent("Así de fácil cada mes.");
    await expectNoViolations(document.body);
    fresh();

    stubInReview(sourced({ status: "confirmed", referenceSource: "typed", folio: "DV-TYPED" }));
    renderPage();
    expect(await screen.findByText("Folio DV-TYPED", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText(/así de fácil cada mes/i)).not.toBeInTheDocument();
  });
});
