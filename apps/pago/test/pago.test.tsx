import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  directPaymentStatusResponse,
  linkStatusResponse,
  payResponse,
  proofUploadResponse,
} from "@devolada/api/direct-payments-schema";
import { BANKS } from "@devolada/api/direct-payments-schema";
import { App } from "../src/App";
import { fail, handlers, ok, server } from "./msw";

/* docs/direct-payment/direct-payment.spec.md scenario 15 (US-D01,
   US-D03, D9, D10): the page's four main flows, in es-MX "pago" copy. */

function renderPage(path = "/p/tok123") {
  window.history.pushState({}, "", path);
  render(<App />);
}

const debtLink = linkStatusResponse.parse({
  ispName: "WifiPlus",
  customerName: "Janely",
  status: "debt",
  monthlyFeeCents: 49900,
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
    expect(screen.getByText("Mensualidad")).toBeInTheDocument();
    expect(screen.getByText("Cargo por servicio")).toBeInTheDocument();
    expect(screen.getByText("Total a pagar")).toBeInTheDocument();
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();
    expect(screen.getByText("WifiPlus SA de CV")).toBeInTheDocument();
    /* D10: the customer's surface says "pago", never "cobro" */
    expect(screen.queryByText(/cobro por servicio/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /enviar comprobante/i })).toBeInTheDocument();
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
                  reconnectionStatus: "reconnected",
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
    await userEvent.click(await screen.findByRole("tab", { name: /datos de la transferencia/i }));
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    /* D16: the bank is picked, not typed. "Nu" — what this test used to
       send — is not a name apiCEP knows, and it answers `invalid` rather
       than an error, so the form is the only place it can be caught. */
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(await screen.findByText(/estamos verificando tu transferencia/i)).toBeInTheDocument();
    expect(screen.getByText("Verificando pago")).toBeInTheDocument();
    /* D1 principle: the client sent only its own transfer data */
    expect(paid[0]).toMatchObject({
      transfer: { trackingKey: "TRACK001XYZ", senderBank: "NUBANK" },
    });
    expect(JSON.stringify(paid[0])).not.toContain("amount");

    /* the poll flips it to the green moment (US-D03) */
    expect(await screen.findByText("Pago confirmado", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/tu servicio ya está activo/i)).toBeInTheDocument();
    expect(screen.getByText(/DV-SPEI01/)).toBeInTheDocument();
  });

  it("scenario 34: the bank is chosen from the vocabulary, never typed (D16)", async () => {
    server.use(handlers.link(() => ok(debtLink)));
    renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: /datos de la transferencia/i }));

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

  it("uploads a screenshot and pays with its proofId", async () => {
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
            reconnectionStatus: "queued",
            folio: "DV-SPEI02",
            validationAttempts: 1,
            error: null,
          }),
        ),
      ),
    );
    renderPage();

    const file = new File([new Uint8Array(100)], "cep.png", { type: "image/png" });
    const picker = await screen.findByLabelText(/captura o comprobante/i);
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

  it("a used transfer reads as exactly that (D8)", async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() => fail("TRANSFER_ALREADY_USED", 409)),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: /datos de la transferencia/i }));
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

  it("scenario 41: a transfer nobody can find keeps verifying, and says so without blaming", async () => {
    server.use(
      handlers.link(() => ok(debtLink)),
      handlers.pay(() =>
        ok(
          payResponse.parse({
            directPaymentId: "dp-1",
            status: "validating",
            error: "TRANSFER_NOT_FOUND",
          }),
          201,
        ),
      ),
      handlers.status(() =>
        ok(
          directPaymentStatusResponse.parse({
            status: "validating",
            validationAttempts: 2,
            error: "TRANSFER_NOT_FOUND",
          }),
        ),
      ),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: /datos de la transferencia/i }));
    await userEvent.type(screen.getByLabelText(/clave de rastreo/i), "TRACK001XYZ");
    await userEvent.selectOptions(screen.getByLabelText(/banco desde el que pagaste/i), "NUBANK");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(await screen.findByText("Verificando pago")).toBeInTheDocument();
    expect(
      await screen.findByText(/todavía no aparece en banxico/i, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    /* the words that made BUG-003 hurt */
    expect(screen.queryByText(/no válido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/revisa los datos e intenta de nuevo/i)).not.toBeInTheDocument();
  });

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

    await userEvent.click(await screen.findByRole("tab", { name: /datos de la transferencia/i }));
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
