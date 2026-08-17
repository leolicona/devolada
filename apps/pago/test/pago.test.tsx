import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  directPaymentStatusResponse,
  linkStatusResponse,
  payResponse,
  proofUploadResponse,
} from "@devolada/api/direct-payments-schema";
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
    await userEvent.type(screen.getByLabelText(/banco desde el que pagaste/i), "Nu");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(await screen.findByText(/estamos verificando tu transferencia/i)).toBeInTheDocument();
    expect(screen.getByText("Verificando pago")).toBeInTheDocument();
    /* D1 principle: the client sent only its own transfer data */
    expect(paid[0]).toMatchObject({
      transfer: { trackingKey: "TRACK001XYZ", senderBank: "Nu" },
    });
    expect(JSON.stringify(paid[0])).not.toContain("amount");

    /* the poll flips it to the green moment (US-D03) */
    expect(await screen.findByText("Pago confirmado", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/tu servicio ya está activo/i)).toBeInTheDocument();
    expect(screen.getByText(/DV-SPEI01/)).toBeInTheDocument();
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
    await userEvent.upload(await screen.findByLabelText(/captura de tu transferencia/i), file);
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
    await userEvent.type(screen.getByLabelText(/banco desde el que pagaste/i), "Nu");
    await userEvent.click(screen.getByRole("button", { name: /verificar mi pago/i }));

    expect(
      await screen.findByText(/esta transferencia ya fue utilizada para otro pago/i),
    ).toBeInTheDocument();
  });
});
