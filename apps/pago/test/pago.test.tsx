import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  directPaymentStatusResponse,
  linkStatusResponse,
  payResponse,
  proofReadingResponse,
  proofUploadResponse,
} from "@devolada/api/direct-payments-schema";
import { BANKS } from "@devolada/api/direct-payments-schema";
import { App } from "../src/App";
import { fail, handlers, ok, server } from "./msw";

/* docs/direct-payment/direct-payment.spec.md scenario 15 (US-D01,
   US-D03, D9, D10): the page's four main flows, in es-MX "pago" copy. */

/* D19 put the remembered step in localStorage, so a test that walks to
   step 2 would otherwise start the next one there. */
beforeEach(() => {
  window.localStorage.clear();
});

function renderPage(path = "/p/tok123") {
  window.history.pushState({}, "", path);
  render(<App />);
}

/* The instructions are two steps (D19): the proof lives on the second,
   and the manual form one deliberate tap inside it. */
async function goToProof() {
  await userEvent.click(await screen.findByRole("button", { name: /ya hice mi transferencia/i }));
}

async function openManualForm() {
  await goToProof();
  await userEvent.click(screen.getByRole("button", { name: /no tengo el comprobante/i }));
}

const debtLink = linkStatusResponse.parse({
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
});

describe("US-D01: the link shows the debt and the SPEI instructions", () => {
  it("renders the breakdown, the CLABE and 'pago' copy after loading", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();

    expect(await screen.findByText("WifiPlus")).toBeInTheDocument();
    expect(screen.getByText("Janely")).toBeInTheDocument();
    expect(screen.getByText("Cargo del periodo")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
    expect(screen.getByText("Total a pagar")).toBeInTheDocument();
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();
    /* D10: the customer's surface says "pago", never "cobro" */
    expect(screen.queryByText(/cobro por servicio/i)).not.toBeInTheDocument();
    /* D19: step 1 is only the transfer; the proof is one tap away */
    expect(screen.getByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
    await goToProof();
    expect(screen.getByRole("heading", { name: /envía tu comprobante/i })).toBeInTheDocument();
  });

  it("says 'sin adeudo' when nothing is due", async () => {
    server.use(
      handlers.link(() =>
        ok(linkStatusResponse.parse({ ispName: "WifiPlus", customerName: "Janely", status: "no_debt" })),
      ),
    );
    renderPage();
    expect(await screen.findByText(/no tienes pagos pendientes/i)).toBeInTheDocument();
  });

  it("degrades into the store network when SPEI is not configured (D4)", async () => {
    server.use(
      handlers.link(() => ok(linkStatusResponse.parse({ ispName: "WifiPlus", status: "unavailable" }))),
    );
    renderPage();
    expect(await screen.findByText(/punto de cobro más cercano/i)).toBeInTheDocument();
  });

  it("an unknown token reads as a wrong link, not an error dump", async () => {
    server.use(handlers.link(() => fail("NOT_FOUND", 404)));
    renderPage();
    expect(await screen.findByText(/este link de pago no existe/i)).toBeInTheDocument();
  });
});

describe("US-D03: submitting transfer data, verifying, and the green moment", () => {
  /* The page polls every 5 s (UI contract state 4), so the flip to
     confirmed arrives after one real interval — the test waits it out */
  it("walks transfer → verificando → confirmado with folio and active service", { timeout: 15000 }, async () => {
    const paid: unknown[] = [];
    let polls = 0;
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay((body) => {
        paid.push(body);
        return ok(
          payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }),
          201,
        );
      }),
      handlers.status(() => {
        polls += 1;
        return ok(
          directPaymentStatusResponse.parse(
            polls === 1
              ? { status: "validating", validationAttempts: 1, error: null }
              : {
                  status: "confirmed",
                  actionOutcome: "done",
                  folio: "DV-SPEI01",
                  validationAttempts: 2,
                  error: null,
                },
          ),
        );
      }),
    );
    renderPage();

    /* the manual door lives behind its tab */
    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    /* D16: the bank is picked, not typed. "Nu" — what this test used to
       send — is not a name apiCEP knows, and it answers `invalid` rather
       than an error, so the form is the only place it can be caught. */
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(await screen.findByText(/estamos verificando tu transferencia/i)).toBeInTheDocument();
    expect(screen.getByText("Verificando pago")).toBeInTheDocument();
    /* US-D13 D3 (amends D1's posture): the amount travels too, pre-filled
       with the expected total the untouched field carries — the payer is
       the source of truth for it, the debt only suggests the default. It
       still cannot change what is charged (scenario 8 there). */
    expect(paid[0]).toMatchObject({
      transfer: {
        trackingKey: "TRACK001XYZ",
        senderBank: "NUBANK",
        amountCents: 51400,
      },
    });

    /* the poll flips it to the green moment (US-D03) */
    expect(await screen.findByText("Pago confirmado", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/tu servicio ya está activo/i)).toBeInTheDocument();
    expect(screen.getByText(/DV-SPEI01/)).toBeInTheDocument();
  });

  it("scenario 34: the bank is chosen from the vocabulary, never typed (D16)", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    await openManualForm();

    /* A combobox, not a textbox — the difference BUG-007 turned on */
    const field = screen.getByLabelText(/banco desde el que pagaste/i);
    expect(field.tagName).toBe("SELECT");

    /* Every option is a name apiCEP resolves. The three the old placeholder
       suggested are not among them. */
    const offered = [...field.querySelectorAll("option")]
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(offered).toHaveLength(BANKS.length);
    expect(new Set(offered)).toEqual(new Set(BANKS));
    for (const wrong of ["Nu", "BBVA", "Banorte"]) expect(offered).not.toContain(wrong);

    /* Nothing can be submitted until one is chosen */
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    expect(screen.getByRole("button", { name: /verificar mi pago/i })).toBeDisabled();
    await userEvent.selectOptions(field, "NUBANK");
    expect(screen.getByRole("button", { name: /verificar mi pago/i })).toBeEnabled();
  });

  /* D18: when the reader is unreachable the payer must not notice.
     No `read` handler is registered here on purpose. */
  it("with no reading available, the upload still pays through the OCR door", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "confirmed", error: null }), 201);
      }),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "confirmed",
            actionOutcome: "queued",
            folio: "DV-SPEI02",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    renderPage();

    await goToProof();
    const file = new File([new Uint8Array(100)], "cep.png", { type: "image/png" });
    const picker = screen.getByLabelText(/captura o comprobante/i);
    /* D12: the picker has to offer PDFs, or the banks that issue one
       never reach the upload at all */
    expect(picker).toHaveAttribute("accept", "image/*,application/pdf");
    await userEvent.upload(picker, file);
    await userEvent.click(screen.getByRole("button", { name: /enviar comprobante/i }));

    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toEqual({ proofId: "link-1/proof-1" });
    expect(await screen.findByText("Pago confirmado")).toBeInTheDocument();
    /* not reconnected yet → the page promises minutes, not the moon */
    expect(screen.getByText(/se reactivará en unos minutos/i)).toBeInTheDocument();
  });

  /* Scenarios 43–45 (D18): the machine reads, the human confirms, the
     direct door validates. */

  const readOk = (over: Record<string, unknown> = {}) =>
    proofReadingResponse.parse({
      source: "reader",
      isReceipt: true,
      amountCents: 51400,
      trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
      senderBank: "NUBANK",
      date: "2026-08-19",
      receiptStatus: "Aceptada",
      gate: { trackingKey: "ok", senderBank: "ok", amount: "ok" },
      ...over,
    });

  async function uploadReceipt() {
    renderPage();
    await goToProof();
    const picker = screen.getByLabelText(/captura o comprobante/i);
    await userEvent.upload(picker, new File([new Uint8Array(100)], "cep.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar comprobante/i }));
  }

  it("scenario 43: a reading that passes the gate is submitted silently — no form at all", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.read(() => ok(readOk())),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "confirmed", error: null }), 201);
      }),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "confirmed",
            actionOutcome: "done",
            folio: "DV-SPEI03",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    await uploadReceipt();

    /* If the reading is right, nobody is asked anything. A confirmation
       in front of every payer is friction they would click through. */
    expect(await screen.findByText("Pago confirmado")).toBeInTheDocument();
    /* no form was ever rendered — "confirmado" would match a loose
       /confirma/i, so assert on the fields instead of the word */
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar/i })).not.toBeInTheDocument();
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      proofId: "link-1/proof-1",
      transfer: { trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", senderBank: "NUBANK" },
      receiptStatus: "Aceptada",
    });
  });

  it("scenario 44: the payer overrides what the machine read, and the override is what travels", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      /* A field the gate refused arrives empty rather than pre-filled
         with something that merely looks confirmable */
      handlers.read(() =>
        ok(
          readOk({
            senderBank: null,
            gate: { trackingKey: "ok", senderBank: "unknown", amount: "ok" },
          }),
        ),
      ),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
      }),
      handlers.status(() =>
        ok(directPaymentStatusResponse.parse({ status: "validating", validationAttempts: 1, error: null })),
      ),
    );
    await uploadReceipt();

    expect(await screen.findByText(/no pudimos sacar todos los datos/i)).toBeInTheDocument();
    const bank = screen.getByLabelText(/banco desde el que pagaste/i);
    expect(bank).toHaveValue("");
    await userEvent.selectOptions(bank, "BBVA MEXICO");

    const key = screen.getByLabelText(/clave de rastreo/i);
    await userEvent.clear(key);
    await userEvent.type(key, "HSBC712057");
    await userEvent.click(screen.getByRole("button", { name: /confirmar y verificar/i }));

    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({
      transfer: { trackingKey: "HSBC712057", senderBank: "BBVA MEXICO" },
    });
  });

  it("scenario 45: an image that is not a receipt is caught here, not six hours later", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.read(() =>
        ok(
          proofReadingResponse.parse({
            source: "reader",
            isReceipt: false,
            amountCents: null,
            trackingKey: null,
            senderBank: null,
            date: null,
            receiptStatus: null,
            gate: { trackingKey: "missing", senderBank: "missing", amount: "missing" },
          }),
        ),
      ),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
      }),
    );
    await uploadReceipt();

    expect(await screen.findByText(/no parece un comprobante/i)).toBeInTheDocument();
    /* Measured live: this image used to make the provider answer `error`,
       which is retryable, so it rode the whole six-hour schedule at up to
       seven paid calls and ended `expired` */
    expect(paid).toHaveLength(0);
    expect(screen.getByRole("button", { name: /intentar de nuevo/i })).toBeInTheDocument();
  });

  /* Scenarios 51–53 (D18): what happens when the silent attempt comes
     back with nothing, which is the ambiguous case by construction. */

  const silentThen = (statusRow: Record<string, unknown>, paid: unknown[]) => [
    handlers.link(() => ok(debtLink)),
    handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
    handlers.read(() => ok(readOk({ receiptStatus: String(statusRow.receiptStatus ?? "Aceptada") }))),
    handlers.pay((body) => {
      paid.push(body);
      return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
    }),
    handlers.status(() =>
      ok(
        directPaymentStatusResponse.parse({
          status: "validating",
          validationAttempts: 1,
          error: "TRANSFER_NOT_FOUND",
          trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
          senderBank: "NUBANK",
          transferDate: "2026-08-19",
          ...statusRow,
        }),
      ),
    ),
  ];

  it("scenario 51: a receipt still 'En proceso' is told to wait, and never shown a form", async () => {
    const paid: unknown[] = [];
    /* US-D12 D1: "En proceso" stays calm at ANY attempt — attempt 5
       would open the form for everyone else */
    server.use(...silentThen({ receiptStatus: "En proceso", validationAttempts: 5 }, paid));
    await uploadReceipt();

    expect(
      await screen.findByText(/tu banco todavía no libera/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    /* Nothing to correct: asking here would invite the payer to break a
       reading that was right */
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no válido/i)).not.toBeInTheDocument();
  });

  it("scenario 52 (US-D12): the first not_found stays calm — the data waits behind a door, not in a form", async () => {
    const paid: unknown[] = [];
    server.use(...silentThen({ receiptStatus: "Aceptada" }, paid));
    await uploadReceipt();

    /* validation-status-ux D1/D2: on attempt 1 the overwhelming prior is
       "Banxico has not published yet" — an open form at minute two reads
       as an accusation. The doors are present; nothing is open. */
    expect(
      await screen.findByText(/validación en proceso/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no válido/i)).not.toBeInTheDocument();

    /* Verifying is free: the collapsible shows what was submitted */
    await userEvent.click(screen.getByRole("button", { name: /ver los datos enviados/i }));
    expect(screen.getByText("NU3AGKMP3ASP8QQQ4U8J8F0K1E4K")).toBeInTheDocument();
    /* Editing is deliberate: one more tap opens the pre-filled form */
    await userEvent.click(screen.getByRole("button", { name: /corregir estos datos/i }));
    expect(screen.getByLabelText(/clave de rastreo/i)).toHaveValue(
      "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    );
  });

  it("scenario 53 (US-D12): a correction through the door re-submits with `supersedes` and carries the image forward", async () => {
    const paid: unknown[] = [];
    server.use(...silentThen({ receiptStatus: "Aceptada" }, paid));
    await uploadReceipt();

    await screen.findByText(/validación en proceso/i, {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole("button", { name: /ver los datos enviados/i }));
    await userEvent.click(screen.getByRole("button", { name: /corregir estos datos/i }));

    const key = await screen.findByLabelText(/clave de rastreo/i);
    await userEvent.clear(key);
    await userEvent.type(key, "HSBC712057");
    await userEvent.click(screen.getByRole("button", { name: /confirmar estos datos/i }));

    await waitFor(() => expect(paid).toHaveLength(2));
    expect(paid[1]).toMatchObject({
      proofId: "link-1/proof-1",
      supersedes: "dp-1",
      transfer: { trackingKey: "HSBC712057" },
    });
  });

  it("US-D13 scenario 6: the correction form pre-fills the amount the payment asked with", async () => {
    const paid: unknown[] = [];
    /* The stuck payment claimed $400.00 — a short transfer whose row
       remembers it. The correction form must offer that number, not the
       debt's: the payer is correcting their own claim. */
    server.use(...silentThen({ receiptStatus: "Aceptada", claimedAmountCents: 40000 }, paid));
    await uploadReceipt();

    await screen.findByText(/validación en proceso/i, {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole("button", { name: /ver los datos enviados/i }));
    await userEvent.click(screen.getByRole("button", { name: /corregir estos datos/i }));

    expect(await screen.findByLabelText(/monto transferido/i)).toHaveValue("400.00");
  });

  it("US-D14 scenario 2: agreement retires the clock — attempt 5 shows evidence, never the form", async () => {
    const paid: unknown[] = [];
    server.use(
      ...silentThen(
        { receiptStatus: "Aceptada", validationAttempts: 5, readingCheck: "agreed" },
        paid,
      ),
    );
    await uploadReceipt();

    /* Without the agreement, attempt 5 opens the pre-filled form. With
       it, the calm is backed by two readers and the form never opens by
       clock (reading-check D3). */
    expect(
      await screen.findByText(/revisamos tu comprobante dos veces/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
    /* The doors stay: verifying is free, editing is deliberate */
    expect(screen.getByRole("button", { name: /ver los datos enviados/i })).toBeInTheDocument();
  });

  it("US-D14 scenario 3: a dispute opens the form now, with the disputed clave empty", async () => {
    const paid: unknown[] = [];
    server.use(
      ...silentThen(
        {
          receiptStatus: "Aceptada",
          validationAttempts: 2,
          readingCheck: "disputed",
          disputedFields: ["trackingKey"],
          claimedAmountCents: 51400,
        },
        paid,
      ),
    );
    await uploadReceipt();

    /* reading-check D4: minute three, not minute forty-five — and the
       ask is about the receipt, never about the machines */
    expect(
      await screen.findByText(/confirma tu clave de rastreo/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/copiarla desde tu app del banco/i)).toBeInTheDocument();
    /* The disputed field arrives empty; the undisputed ones pre-filled */
    expect(screen.getByLabelText(/clave de rastreo/i)).toHaveValue("");
    expect(screen.getByLabelText(/monto transferido/i)).toHaveValue("514.00");
    expect(screen.getByLabelText(/banco desde el que pagaste/i)).toHaveValue("NUBANK");
  });

  it("US-D14 scenario 8: an agreed payment that expires carries its diagnosis", async () => {
    const paid: unknown[] = [];
    server.use(
      ...silentThen(
        { status: "expired", validationAttempts: 8, readingCheck: "agreed", error: null },
        paid,
      ),
    );
    await uploadReceipt();

    expect(
      await screen.findByText(/banxico no publicó la transferencia/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/puede registrar tu pago a mano/i)).toBeInTheDocument();
  });

  it("US-D15 D9: a release retires the clock and says the internet is back", async () => {
    const paid: unknown[] = [];
    /* Attempt 5 opens the form for everyone else; a released ride shows
       its one fused sentence instead — evidence and consequence together */
    server.use(
      ...silentThen(
        {
          receiptStatus: "Aceptada",
          validationAttempts: 5,
          provisionalRelease: { evidence: "human", kind: "reconnect" },
        },
        paid,
      ),
    );
    await uploadReceipt();

    expect(
      await screen.findByText(/tu internet ya volvió/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
  });

  it("US-D15 D9: the protect face never says the internet came back", async () => {
    const paid: unknown[] = [];
    /* A current customer's service never left — "ya volvió" would lie */
    server.use(
      ...silentThen(
        {
          error: null,
          provisionalRelease: { evidence: "pending", kind: "protect" },
        },
        paid,
      ),
    );
    await uploadReceipt();

    expect(
      await screen.findByText(/tu servicio sigue activo/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ya volvió/i)).not.toBeInTheDocument();
  });

  it("US-D15 D7: the expired page offers one retry, and the claim re-travels the same data", async () => {
    const paid: unknown[] = [];
    server.use(
      ...silentThen(
        {
          status: "expired",
          validationAttempts: 8,
          error: null,
          provisionalRelease: { evidence: "agreed", kind: "reconnect" },
          retryAvailable: true,
          claimedAmountCents: 51400,
        },
        paid,
      ),
    );
    await uploadReceipt();

    expect(await screen.findByText(/volvió a pausa/i, {}, { timeout: 8000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reintentar ahora/i }));

    await waitFor(() => expect(paid).toHaveLength(2));
    expect(paid[1]).toMatchObject({
      transfer: {
        trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
        senderBank: "NUBANK",
        amountCents: 51400,
      },
    });
  });

  it("US-D13 scenario 2: the manual door's amount is editable, and the edited number travels", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay((body) => {
        paid.push(body);
        return ok(
          payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }),
          201,
        );
      }),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "validating",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    renderPage();
    await openManualForm();

    /* Pre-filled with the expected total — the exact payer never touches
       it (D3). This payer transferred $499.00 instead. */
    const amount = screen.getByLabelText(/monto transferido/i);
    expect(amount).toHaveValue("514.00");
    await userEvent.clear(amount);
    await userEvent.type(amount, "499");
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    await waitFor(() => expect(paid).toHaveLength(1));
    expect(paid[0]).toMatchObject({ transfer: { amountCents: 49900 } });
  });

  it("US-D13 scenario 7: without a configured beneficiary name the row simply is not there", async () => {
    const { speiBeneficiaryName: _omitted, ...nameless } = debtLink;
    server.use(handlers.link(() => ok(linkStatusResponse.parse(nameless))));
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: /ver los demás datos/i }, { timeout: 8000 }),
    );
    /* Banco and concepto still render; the missing name leaves no gap */
    expect(screen.getAllByText("Banco").length).toBeGreaterThan(0);
    expect(screen.queryByText("Beneficiario")).not.toBeInTheDocument();
  });

  it("US-D12 scenario 2: from the 45-minute attempt the form is in the foreground, still suspecting the wait", async () => {
    const paid: unknown[] = [];
    /* The inline attempt is #1 and the D7 slots follow, so the
       45-minute attempt is #5 — the moment the wait stops being normal */
    server.use(...silentThen({ validationAttempts: 5 }, paid));
    await uploadReceipt();

    expect(
      await screen.findByText(/tardando más de lo normal/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/clave de rastreo/i)).toHaveValue(
      "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
    );
    /* still framed as a wait, never as an accusation */
    expect(screen.queryByText(/no válido/i)).not.toBeInTheDocument();
  });

  it("US-D12 scenario 4: the long wait names the hour of the next attempt and the way to a human", async () => {
    const paid: unknown[] = [];
    const lateAt = Date.now() + 6 * 60 * 60 * 1000;
    server.use(...silentThen({ validationAttempts: 7, nextValidationAt: lateAt }, paid));
    await uploadReceipt();

    /* D5: a promise the cron keeps — the hour of the late attempt —
       never "te daremos noticias" on a channel that does not exist */
    const copy = await screen.findByText(/tardando más de lo esperado/i, {}, { timeout: 8000 });
    const hour = new Date(lateAt).toLocaleTimeString("es-MX", {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(copy.textContent).toContain(`alrededor de las ${hour}`);
    expect(copy.textContent).toMatch(/contactar a tu proveedor/i);
    /* no form in the foreground — the doors stay */
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /subir otro comprobante/i })).toBeInTheDocument();
  });

  it("US-D12 scenario 7: an unread date arrives empty in the confirmation, never today's", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.read(() => ok(readOk({ date: null }))),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
      }),
    );
    await uploadReceipt();

    /* D6: a date the machine did not read is a missing field, like clave
       and banco — pre-filling today invents a confirmable-looking value */
    expect(await screen.findByText(/no pudimos sacar todos los datos/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fecha de la transferencia/i)).toHaveValue("");
    /* nothing was spent on an invented date */
    expect(paid).toHaveLength(0);
  });

  it("US-D12 scenario 8: 'Subir otro comprobante' walks back to step 2 and the fresh proof supersedes", async () => {
    const paid: unknown[] = [];
    server.use(...silentThen({}, paid));
    await uploadReceipt();

    await screen.findByText(/validación en proceso/i, {}, { timeout: 8000 });
    /* D7: the payer who knows the receipt is wrong does not wait out a
       validation they already know is lost */
    await userEvent.click(screen.getByRole("button", { name: /subir otro comprobante/i }));

    expect(
      await screen.findByRole("heading", { name: /envía tu comprobante/i }),
    ).toBeInTheDocument();
    const picker = screen.getByLabelText(/captura o comprobante/i);
    await userEvent.upload(picker, new File([new Uint8Array(100)], "cep2.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar comprobante/i }));

    /* the new submission releases the old claim instead of racing it —
       without `supersedes` the payer would be told TRANSFER_ALREADY_USED
       by their own first attempt */
    await waitFor(() => expect(paid).toHaveLength(2));
    expect(paid[1]).toMatchObject({
      supersedes: "dp-1",
      transfer: { trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K" },
    });
  });

  it("scenario 57 (US-D10 D1/D12): a short receipt is submitted with its own amount, never refused", async () => {
    /* This asserted the $1 receipt was refused before any credit. That
       refusal predated partial payments: by the time we know the transfer
       fell short, the money is already in the ISP's account, and D12 sends
       the receipt's own amount to Banxico so the short transfer is
       findable. The page's only remaining refusal is the other direction —
       a reading *above* the debt (a misread). */
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      /* $1.00 against a $514.00 debt */
      handlers.read(() => ok(readOk({ amountCents: 100 }))),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
      }),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "partial",
            receivedCents: 100,
            debtCents: 49900,
            missingCents: 49800,
            actionOutcome: "withheld",
            folio: "DV-SPEI04",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    await uploadReceipt();

    expect(await screen.findByText("Pago incompleto", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(paid).toHaveLength(1);
    /* D12: the amount printed on the receipt travels with the submission,
       so the lookup asks Banxico about the transfer that really happened */
    expect(paid[0]).toMatchObject({
      proofId: "link-1/proof-1",
      transfer: { trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K", senderBank: "NUBANK" },
      receiptAmountCents: 100,
    });
  });

  it("a receipt claiming more than the debt is informed, never refused (US-D13, D2)", async () => {
    const paid: unknown[] = [];
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      /* $600.00 against a $514.00 debt */
      handlers.read(() => ok(readOk({ amountCents: 60000 }))),
      handlers.pay((body) => {
        paid.push(body);
        return ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201);
      }),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "validating",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    await uploadReceipt();

    /* US-D13 D2: the confirmation screen says both numbers and where the
       surplus goes, before anything is spent — the old refusal died with
       the correction doors. */
    expect(
      await screen.findByText(/el sobrante quedará a favor/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("$600.00")).toBeInTheDocument();
    expect(screen.getByText("$514.00")).toBeInTheDocument();
    expect(paid).toHaveLength(0);
    /* D2 amended: consent about the surplus, never proofreading — the
       clean-gate screen carries the surplus sentence and nothing else;
       the minute-two cross owns content verification now */
    expect(screen.queryByText(/si algo no coincide/i)).not.toBeInTheDocument();

    /* Confirming travels with the receipt's own amount (D1: the receipt
       is the source of truth, the debt only judges) */
    await userEvent.click(screen.getByRole("button", { name: /confirmar y verificar/i }));
    expect(await screen.findByText("Verificando pago", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      transfer: { amountCents: 60000 },
      receiptAmountCents: 60000,
    });
  }, 20_000);

  it("a used transfer reads as exactly that (D8)", async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() => fail("TRANSFER_ALREADY_USED", 409)),
    );
    renderPage();

    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    /* D16: the bank is picked, not typed. "Nu" — what this test used to
       send — is not a name apiCEP knows, and it answers `invalid` rather
       than an error, so the form is the only place it can be caught. */
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(
      await screen.findByText(/esta transferencia ya fue utilizada para otro pago/i),
    ).toBeInTheDocument();
  });

  /* Scenarios 41–42 (D17/BUG-003): the two things the page must never
     confuse — "we could not verify it" and "you did not pay". */

  it("scenario 42: the expired verification names the wall it hit, not the customer", async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() =>
        ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201),
      ),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "expired",
            validationAttempts: 6,
            error: "TRANSFER_NOT_FOUND",
          }),
        ),
      ),
    );
    renderPage();

    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(
      await screen.findByText("Verificación expirada", {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no encontramos tu transferencia en banxico/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/contacta a tu proveedor/i)).toBeInTheDocument();
  });
});

/* docs/direct-payment/partial-payment.spec.md scenario 9 (US-D10, D7):
   the `partial` state speaks in pesos, never a percentage, and keeps the
   SPEI instructions in reach — the payer's next action is another
   transfer. */
describe("US-D10: the partial state", () => {
  async function shortManualPayment(statusRows: Record<string, unknown>[]) {
    let polls = 0;
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() =>
        ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201),
      ),
      handlers.status(() => {
        polls = Math.min(polls + 1, statusRows.length);
        return ok(
          directPaymentStatusResponse.parse({
            validationAttempts: 1,
            error: null,
            ...statusRows[polls - 1],
          }),
        );
      }),
    );
    renderPage();
    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));
  }

  const withheld = {
    status: "partial",
    receivedCents: 30000,
    debtCents: 49900,
    missingCents: 19900,
    actionOutcome: "withheld",
    folio: "DV-SPEI05",
  };

  it("scenario 9: three amounts in pesos, no percentage, and the CLABE still visible", async () => {
    await shortManualPayment([withheld]);

    expect(await screen.findByText("Pago incompleto", {}, { timeout: 8000 })).toBeInTheDocument();
    /* D7: what arrived, what was owed, what is missing — as money */
    expect(screen.getByText("$300.00")).toBeInTheDocument();
    expect(screen.getByText("$499.00")).toBeInTheDocument();
    expect(screen.getByText(/faltan/i)).toBeInTheDocument();
    expect(screen.getByText("$199.00")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("%");
    /* withheld, so the service waits for the rest — and no green tick */
    expect(screen.getByText(/cuando llegue el resto/i)).toBeInTheDocument();
    expect(screen.queryByText(/pago confirmado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/DV-SPEI05/)).toBeInTheDocument();
    /* UI contract: the next action is another transfer, so the CLABE
       never leaves the screen */
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();
  });

  it("a partial that met the threshold keeps polling until the reconnection lands", { timeout: 15000 }, async () => {
    /* Threshold met, WispHub down: the money needs nothing more, so the
       page must not say "cuando llegue el resto" — and it must keep
       watching, or "en unos minutos" never becomes "ya está activo". */
    await shortManualPayment([
      { ...withheld, actionOutcome: "queued" },
      { ...withheld, actionOutcome: "done" },
    ]);

    expect(
      await screen.findByText(/se reactivará en unos minutos/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cuando llegue el resto/i)).not.toBeInTheDocument();
    /* the poll flips it without any tap */
    expect(
      await screen.findByText(/ya está activo/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
  });

  it("'Ver los datos para transferir' lands on the transfer data, not the upload form", async () => {
    /* `retry` alone left the remembered step at `proof`, so this button
       landed on "Envía tu comprobante" — promising the CLABE and showing
       a file picker. */
    await shortManualPayment([withheld]);
    await screen.findByText("Pago incompleto", {}, { timeout: 8000 });

    await userEvent.click(screen.getByRole("button", { name: /ver los datos para transferir/i }));
    expect(
      await screen.findByRole("heading", { name: /haz tu transferencia/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Total a pagar")).toBeInTheDocument();
  });

  it("BUG-011: after a receipt-born partial, the button lands on the CLABE, not the stale draft", async () => {
    /* The draft (D18) renders ahead of the step machine, and the pay
       success never consumed it — so this button used to resurface the
       old reading, complete with the "no pudimos sacar todos los datos"
       warning, instead of the transfer data it promises. */
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.proof(() => ok(proofUploadResponse.parse({ proofId: "link-1/proof-1" }))),
      handlers.read(() =>
        ok(
          proofReadingResponse.parse({
            source: "reader",
            isReceipt: true,
            amountCents: 30000,
            trackingKey: "NU3AGKMP3ASP8QQQ4U8J8F0K1E4K",
            senderBank: null,
            date: "2026-08-19",
            receiptStatus: "Aceptada",
            gate: { trackingKey: "ok", senderBank: "unknown", amount: "ok" },
          }),
        ),
      ),
      handlers.pay(() =>
        ok(payResponse.parse({ directPaymentId: "dp-1", status: "validating", error: null }), 201),
      ),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            validationAttempts: 1,
            error: null,
            ...withheld,
          }),
        ),
      ),
    );
    renderPage();
    await goToProof();
    const picker = screen.getByLabelText(/captura o comprobante/i);
    await userEvent.upload(picker, new File([new Uint8Array(100)], "cep.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar comprobante/i }));

    /* the incomplete reading asks the payer to finish it (D18) */
    expect(await screen.findByText(/no pudimos sacar todos los datos/i)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /confirmar y verificar/i }));

    await screen.findByText("Pago incompleto", {}, { timeout: 8000 });
    await userEvent.click(screen.getByRole("button", { name: /ver los datos para transferir/i }));

    /* the draft was consumed when the payment was born: step 1 renders,
       and nothing about the old reading survives */
    expect(
      await screen.findByRole("heading", { name: /haz tu transferencia/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no pudimos sacar todos los datos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confirma estos datos/i)).not.toBeInTheDocument();
  });
});

/* docs/direct-payment/direct-payment.spec.md scenarios 57–62 (D19): the
   instructions are two steps, and the device remembers which one — the
   transfer happens in the bank app, and coming back is usually a fresh
   page load. */
describe("US-D01: the page is two steps and remembers the moment", () => {
  /* What an app switch, or a tap on the ISP's WhatsApp link the next
     morning, actually costs: a new page load on the same device. */
  function reopen() {
    cleanup();
    renderPage();
  }

  it("scenario 59: after 'ya hice mi transferencia', reopening lands on the proof, not the CLABE", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    await goToProof();

    reopen();
    expect(
      await screen.findByRole("heading", { name: /envía tu comprobante/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Paso 2 de 2")).toBeInTheDocument();
    expect(screen.queryByText("646180157000000004")).not.toBeInTheDocument();
  });

  it("scenario 60: the way back is on the screen, and it is not undone by reopening", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    await goToProof();

    /* A payer who tapped too early must not reload to see the CLABE */
    await userEvent.click(screen.getByRole("button", { name: /ver los datos otra vez/i }));
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();

    reopen();
    expect(await screen.findByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
  });

  it("scenario 61: step 1 shows the two lines the bank needs; the rest is reachable, not stacked", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();

    expect(await screen.findByText("646180157000000004")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copiar monto exacto/i })).toBeInTheDocument();
    /* Beneficiario, banco and concepto are checked once, if at all */
    expect(screen.queryByText("WifiPlus SA de CV")).not.toBeInTheDocument();
    expect(screen.queryByText("greyes@wifiplus")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ver los demás datos/i }));
    expect(await screen.findByText("WifiPlus SA de CV")).toBeInTheDocument();
    expect(screen.getByText("greyes@wifiplus")).toBeInTheDocument();
    expect(screen.getByText("STP")).toBeInTheDocument();
  });

  it("scenario 61: the amount copies as a number — a bank does not take '$514.00'", async () => {
    const user = userEvent.setup();
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /copiar monto exacto/i }));
    expect(await navigator.clipboard.readText()).toBe("514.00");
    /* and it is read as money on the screen exactly once: the amount is
       the breakdown's own total, not a second row repeating it */
    expect(screen.getAllByText("$514.00")).toHaveLength(1);
  });

  it("scenario 62: step 2 opens on the upload, with no tab strip and the form one tap away", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    await goToProof();

    /* D18 earned the upload its primacy; tabs made the harder path a peer */
    expect(screen.getByLabelText(/captura o comprobante/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByLabelText(/clave de rastreo/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /no tengo el comprobante/i }));
    expect(screen.getByLabelText(/clave de rastreo/i)).toBeInTheDocument();
    /* the upload does not disappear when the fallback opens */
    expect(screen.getByLabelText(/captura o comprobante/i)).toBeInTheDocument();
  });

  it("scenario 63: a confirmed payment gives the step back, so next month starts at the beginning", async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() =>
        ok(payResponse.parse({ directPaymentId: "dp-61", status: "confirmed", error: null }), 201),
      ),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "confirmed",
            actionOutcome: "done",
            folio: "DV-SPEI09",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    renderPage();

    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));
    expect(await screen.findByText("Pago confirmado")).toBeInTheDocument();

    reopen();
    expect(await screen.findByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
  });

  it("scenario 64: a payment still validating keeps the step; 'sin adeudo' clears it", { timeout: 15000 }, async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() =>
        ok(payResponse.parse({ directPaymentId: "dp-62", status: "validating", error: null }), 201),
      ),
      handlers.status(() =>
        ok(directPaymentStatusResponse.parse({ status: "validating", validationAttempts: 1, error: null })),
      ),
    );
    renderPage();

    await openManualForm();
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));
    expect(await screen.findByText(/estamos verificando tu transferencia/i)).toBeInTheDocument();

    /* That payer has not finished: reopening must not send them back to
       a CLABE they already used. */
    reopen();
    expect(
      await screen.findByRole("heading", { name: /envía tu comprobante/i }),
    ).toBeInTheDocument();

    /* Paid at last: the link says there is nothing due, and the step goes */
    cleanup();
    server.use(
      handlers.link(() =>
        ok(linkStatusResponse.parse({ ispName: "WifiPlus", customerName: "Janely", status: "no_debt" })),
      ),
    );
    renderPage();
    expect(await screen.findByText(/no tienes pagos pendientes/i)).toBeInTheDocument();

    cleanup();
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    expect(await screen.findByRole("heading", { name: /haz tu transferencia/i })).toBeInTheDocument();
  });
});
