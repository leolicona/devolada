import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  businessRow,
  businessesListResponse,
  createStoreResponse,
  platformLedgerResponse,
  settingsListResponse,
  storesListResponse,
} from "@devolada/api/platform-schema";
import { feedResponse } from "@devolada/api/payments-schema";
import { DEFAULT_RECEIPT_TEMPLATE } from "@devolada/api/platform-schema";
import { creditEntriesResponse } from "@devolada/api/credit-schema";
import { businessActor, fail, handlers, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US2 (FR-001–FR-007, FR-030, FR-043; research D4, D7,
   D21, D22, D31): the operator sets the pilot up from /operador — the
   Tiendas tab with every store's status as icon + text, creation with
   the invitation shown once, suspend and reactivate behind a
   confirmation, the business's *Efectivo en tiendas* switch with the
   reason it refuses, the two new Reglas, and a correction in a store's
   cash book. Fixtures parse with the contract (constitution III). */

const operator = { ...businessActor, platformOperator: true };
const at = Date.UTC(2026, 9, 1, 17, 0);

const emptyFeed = feedResponse.parse({
  payments: [],
  nextCursor: null,
  effectiveOverTreatment: "flag",
  today: { count: 0, totalCents: 0, startedAtMs: 0 },
});

const settings = settingsListResponse.parse({
  settings: [
    { key: "store_fee_cents", type: "cents", birth: "1500", current: "1500", history: [] },
    { key: "store_receipt_template", type: "template", birth: DEFAULT_RECEIPT_TEMPLATE, current: DEFAULT_RECEIPT_TEMPLATE, history: [] },
  ],
});

const lupita = {
  id: "s1",
  name: "Abarrotes Lupita",
  address: "Av. Juárez 12, Centro",
  shopkeeperName: "Guadalupe Reyes",
  phone: "5512345678",
  status: "active",
  createdAt: at,
  collectsFor: [{ businessId: "b1", businessName: "WifiPlus", heldCents: 89900 }],
};
const stores = storesListResponse.parse({
  stores: [
    lupita,
    { ...lupita, id: "s2", name: "Papelería El Sol", phone: "5587654321", status: "invited", collectsFor: [] },
    { ...lupita, id: "s3", name: "Farmacia Luz", phone: "5511112222", status: "suspended", collectsFor: [] },
  ],
});

function arrange(extra: Parameters<typeof server.use> = []) {
  server.use(
    handlers.session(() => ok(operator)),
    handlers.feed(() => ok(emptyFeed)),
    handlers.support(() => ok({ whatsapp: "5215512345678", email: "hola@devoladapago.com" })),
    handlers.platformSettings(() => ok(settings)),
    handlers.platformStores(() => ok(stores)),
    ...extra,
  );
  renderApp("/operador");
}

async function openStores() {
  await userEvent.click(await screen.findByRole("tab", { name: "Tiendas" }));
  return screen.findByRole("list", { name: "Tiendas" });
}

const item = (name: string) => screen.getByText(name, { selector: "p" }).closest("li") as HTMLElement;

describe("cash-at-stores US2: the operator's Tiendas tab", () => {
  it("lists every store with its shopkeeper, its status as icon + text and the businesses it holds cash for", async () => {
    arrange();
    await openStores();
    const first = item("Abarrotes Lupita");
    expect(within(first).getByText(/Guadalupe Reyes/)).toBeInTheDocument();
    expect(within(first).getByText("55 1234 5678")).toBeInTheDocument();
    expect(within(first).getByText("Tienda activa")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /WifiPlus · tiene \$899\.00/ })).toBeInTheDocument();
    expect(within(item("Papelería El Sol")).getByText("Invitación enviada")).toBeInTheDocument();
    expect(within(item("Farmacia Luz")).getByText("Tienda suspendida")).toBeInTheDocument();
    /* a resend belongs to a store that never accepted */
    expect(within(item("Papelería El Sol")).getByRole("button", { name: "Reenviar invitación" })).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: "Reenviar invitación" })).not.toBeInTheDocument();
    await expectNoViolations(screen.getByRole("tabpanel"));
  });

  it("creates a store after naming each problem, then shows the invitation once with Copiar and WhatsApp", async () => {
    const created: unknown[] = [];
    arrange([
      handlers.createStore((body) => {
        created.push(body);
        return ok(
          createStoreResponse.parse({
            store: { ...lupita, id: "s9", name: "Tienda Nueva", status: "invited", collectsFor: [] },
            invitation: { url: "https://red.devoladapago.com/invitacion/tok123", expiresAt: at + 7 * 86_400_000, waLink: "https://wa.me/525512340000?text=hola" },
          }),
          201,
        );
      }),
    ]);
    await openStores();
    await userEvent.click(screen.getByRole("button", { name: "Nueva tienda" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText("Celular del tendero"), "55 1234");
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear e invitar" }));
    expect(within(dialog).getByText("Escribe el nombre de la tienda (2 a 80 letras).")).toBeInTheDocument();
    expect(within(dialog).getByText("Escribe los 10 dígitos del celular.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Celular del tendero")).toHaveAttribute("aria-invalid", "true");
    expect(created).toEqual([]);

    await userEvent.type(within(dialog).getByLabelText("Nombre de la tienda"), "Tienda Nueva");
    await userEvent.type(within(dialog).getByLabelText("Dirección"), "Calle Hidalgo 3");
    await userEvent.type(within(dialog).getByLabelText("Nombre del tendero"), "Rosa Díaz");
    await userEvent.clear(within(dialog).getByLabelText("Celular del tendero"));
    await userEvent.type(within(dialog).getByLabelText("Celular del tendero"), "+52 55 1234 0000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear e invitar" }));

    /* constitution: the phone travels as ten digits (nationalPhone, L5) */
    await waitFor(() =>
      expect(created).toEqual([{ name: "Tienda Nueva", address: "Calle Hidalgo 3", shopkeeperName: "Rosa Díaz", phone: "5512340000" }]),
    );
    expect(await within(dialog).findByText("Tienda creada")).toBeInTheDocument();
    expect(within(dialog).getByText(/Se muestra solo esta vez/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Enlace de la invitación")).toHaveValue("https://red.devoladapago.com/invitacion/tok123");
    expect(within(dialog).getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute("href", "https://wa.me/525512340000?text=hola");
    /* a production link carries no local-machine warning */
    expect(within(dialog).queryByText(/equipo local/)).not.toBeInTheDocument();
    await expectNoViolations(dialog);

    /* closed, the plaintext link is gone: the next open is a new form */
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Nueva tienda" }));
    expect(await screen.findByRole("button", { name: "Crear e invitar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Enlace de la invitación")).not.toBeInTheDocument();
  });

  it("warns when the invitation points at a local machine (RED_BASE_URL unset)", async () => {
    arrange([
      handlers.resendStoreInvitation(() =>
        ok({ invitation: { url: "http://localhost:5177/invitacion/tok", expiresAt: at, waLink: "https://wa.me/525587654321?text=x" } }),
      ),
    ]);
    await openStores();
    await userEvent.click(within(item("Papelería El Sol")).getByRole("button", { name: "Reenviar invitación" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/La invitación anterior dejó de funcionar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/apunta a un equipo local/)).toBeInTheDocument();
  });

  it("says when the phone belongs to another store", async () => {
    arrange([handlers.createStore(() => fail("PHONE_TAKEN", 409))]);
    await openStores();
    await userEvent.click(screen.getByRole("button", { name: "Nueva tienda" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nombre de la tienda"), "Tienda Nueva");
    await userEvent.type(within(dialog).getByLabelText("Dirección"), "Calle Hidalgo 3");
    await userEvent.type(within(dialog).getByLabelText("Nombre del tendero"), "Rosa Díaz");
    await userEvent.type(within(dialog).getByLabelText("Celular del tendero"), "5512345678");
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear e invitar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Otra tienda ya usa ese celular.");
  });

  it("suspends and reactivates, each behind a confirmation", async () => {
    const patched: [string, unknown][] = [];
    arrange([
      handlers.patchStore((id, body) => {
        patched.push([id, body]);
        return ok({ ...lupita, id });
      }),
    ]);
    await openStores();
    await userEvent.click(within(item("Abarrotes Lupita")).getByRole("button", { name: "Suspender" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByRole("heading")).toHaveTextContent("¿Suspender Abarrotes Lupita?");
    expect(within(confirm).getByText(/no podrá entrar ni cobrar/)).toBeInTheDocument();
    expect(patched).toEqual([]);
    await userEvent.click(within(confirm).getByRole("button", { name: "Suspender" }));
    await waitFor(() => expect(patched).toEqual([["s1", { status: "suspended" }]]));

    await userEvent.click(within(item("Farmacia Luz")).getByRole("button", { name: "Reactivar" }));
    const again = await screen.findByRole("alertdialog");
    await userEvent.click(within(again).getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(patched).toContainEqual(["s3", { status: "active" }]));
  });

  it("records a correction against one payment, with a reason of 3 to 280 letters (D21)", async () => {
    const corrections: unknown[] = [];
    const ledger = platformLedgerResponse.parse({
      heldCents: 89900,
      nextCursor: null,
      rows: [
        { id: "l1", kind: "collection", cents: 39900, at, businessId: "b1", businessName: "WifiPlus", folio: "DV-CASH01", customerName: "Mario Pérez", feeCents: 1500, reason: null, paymentId: "p1", authorEmail: null },
        { id: "l2", kind: "collection", cents: 50000, at: at + 1, businessId: "b1", businessName: "WifiPlus", folio: "DV-CASH02", customerName: "Ana Ruiz", feeCents: 1500, reason: null, paymentId: "p2", authorEmail: null },
      ],
    });
    arrange([
      handlers.storeLedger(() => ok(ledger)),
      handlers.storeCorrection((_id, _b, body) => {
        corrections.push(body);
        return ok({ id: "c1", cents: -5000, reason: "x", createdAt: at }, 201);
      }),
    ]);
    await openStores();
    await userEvent.click(within(item("Abarrotes Lupita")).getByRole("button", { name: /WifiPlus · tiene/ }));
    expect(await screen.findByRole("list", { name: "Movimientos de la caja" })).toHaveTextContent("DV-CASH01");

    await userEvent.selectOptions(screen.getByLabelText("Pago al que se refiere"), "p1");
    await userEvent.type(screen.getByLabelText("Monto de la corrección"), "50");
    const submit = screen.getByRole("button", { name: "Registrar corrección" });
    await userEvent.type(screen.getByLabelText(/Motivo \(de 3 a 280 letras\)/), "ok");
    expect(screen.getByText("El motivo debe tener de 3 a 280 letras.")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo \(de 3 a 280 letras\)/), " — se capturó $50 de más");
    expect(submit).toBeEnabled();
    await expectNoViolations(screen.getByRole("tabpanel"));
    await userEvent.click(submit);
    await waitFor(() => expect(corrections).toEqual([{ paymentId: "p1", cents: -5000, reason: "ok — se capturó $50 de más" }]));
  });
});

describe("cash-at-stores US2: the switch and the rules", () => {
  const wifiplus = {
    id: "b1",
    name: "WifiPlus",
    email: "owner@wifiplus.mx",
    status: "active",
    balanceCents: 1500,
    step: "low",
    feeCents: 500,
    feeOverrideCents: null,
    createdAt: 1,
    storeChannel: { on: false, since: null },
    capabilities: ["receivables", "customerDebt"],
    storeHeldCents: 0,
  };

  async function openBusiness(row: typeof wifiplus, extra: Parameters<typeof server.use> = []) {
    arrange([
      handlers.platformBusinesses(() => ok(businessesListResponse.parse({ businesses: [row] }))),
      handlers.platformBusiness(() =>
        ok({ ...businessRow.parse(row), ...creditEntriesResponse.parse({ entries: [], nextCursor: null }) }),
      ),
      ...extra,
    ]);
    await userEvent.click(await screen.findByRole("tab", { name: "Negocios" }));
    await userEvent.click(await screen.findByRole("button", { name: /WifiPlus/ }));
    return screen.findByRole("switch", { name: "Efectivo en tiendas" });
  }

  it("names what the integration cannot do and keeps the switch off (FR-007)", async () => {
    const toggle = await openBusiness(wifiplus);
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText("No se puede activar: la integración de este negocio no puede buscar clientes, registrar pagos ni reconectar."),
    ).toBeInTheDocument();
  });

  it("switches on a capable business, and says why when another business already collects (D7)", async () => {
    const asked: unknown[] = [];
    const toggle = await openBusiness(
      { ...wifiplus, capabilities: ["receivables", "customerDebt", "customerSearch", "paymentActions"] },
      [
        handlers.patchBusiness((_id, body) => {
          asked.push(body);
          return fail("ONE_BUSINESS_AT_A_TIME", 409);
        }),
      ],
    );
    expect(toggle).toBeEnabled();
    await userEvent.click(toggle);
    await waitFor(() => expect(asked).toEqual([{ storeChannel: true }]));
    expect(await screen.findByRole("alert")).toHaveTextContent("Otro negocio ya cobra en tiendas.");
  });

  it("labels the two new Reglas in the operator's words", async () => {
    arrange();
    expect(await screen.findByLabelText("Cargo por servicio en tiendas")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje del comprobante (WhatsApp)")).toBeInTheDocument();
  });

  it("the receipt's message: a text area, the placeholders, a live preview, and the API's three checks before it saves (D31)", async () => {
    const saved: [string, unknown][] = [];
    arrange([
      handlers.setPlatformSetting((key, body) => {
        saved.push([key, body]);
        return ok({ key, value: "x", createdAt: 1 }, 201);
      }),
    ]);
    const field = await screen.findByLabelText("Mensaje del comprobante (WhatsApp)");
    expect(field.tagName).toBe("TEXTAREA");
    expect(screen.getByText("{pendiente}")).toBeInTheDocument();
    const preview = screen.getByLabelText("Vista previa del comprobante");
    expect(preview).toHaveTextContent("Folio: DV-7K2Q9M");
    expect(preview).toHaveTextContent("Abarrotes Lupita");
    const save = screen.getByRole("button", { name: "Guardar Mensaje del comprobante (WhatsApp)" });

    /* `paste`, not `type`: user-event reads a brace as a key name */
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste("Gracias por tu pago, {cliente}. Te esperamos.");
    expect(screen.getByRole("alert")).toHaveTextContent("Falta {folio}: el comprobante necesita el folio.");
    expect(save).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.paste("Folio {folio} para {nombre}, gracias por tu pago.");
    expect(screen.getByRole("alert")).toHaveTextContent("No conocemos {nombre}. Usa solo los marcadores de la lista.");
    expect(save).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.paste("Folio {folio}: gracias, {cliente}.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(preview).toHaveTextContent("Folio DV-7K2Q9M: gracias, Guadalupe Reyes.");
    await expectNoViolations(screen.getByRole("tabpanel"));
    await userEvent.click(save);
    await waitFor(() => expect(saved).toEqual([["store_receipt_template", { value: "Folio {folio}: gracias, {cliente}." }]]));
  });
});
