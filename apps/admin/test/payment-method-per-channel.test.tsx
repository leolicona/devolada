import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { devoladaMethods, integrationsResponse, wisphubTestResponse } from "@devolada/api/integrations-schema";
import { businessActor, fail, handlers, METHOD_LINES, methodsBlock, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* payment-method-per-channel US4 (contracts/integrations-payment-methods.md,
   "The screen"): after the connection, the WispHub screen shows each of
   Devolada's payment methods with its name and description to copy and
   whether the business already created it; execution turns on only once
   they exist (FR-008, FR-009, FR-013). */

const wisphub = (over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) =>
  integrationsResponse.parse({
    wisphub: {
      provider: "wisphub",
      configured: true,
      keyTail: "1234",
      installation: "wisphub_net",
      effectiveInstallation: { key: "wisphub_net", label: "wisphub.net", kind: "real", assumed: false },
      actionsEnabled: false,
      mapping: { exact: "register_and_reconnect", short: "register_and_reconnect", over: "register_and_reconnect" },
      thresholdPercent: 100,
      floorCents: 0,
      provisionalReleaseEnabled: false,
      ...over,
    },
    api: { activeCredentials: 0 },
    ...rest,
  });

const testResult = (devolada: unknown) =>
  wisphubTestResponse.parse({
    ok: true,
    outcome: "OK",
    triedInstallation: { key: "wisphub_net", label: "wisphub.net" },
    verified: ["customers", "invoices", "payment_methods"],
    unverified: ["create_invoice", "register_payment", "auto_activate", "payment_promise"],
    missingPermission: null,
    sampleCustomerCount: 1,
    devoladaMethods: devolada,
  });

const UNCHECKED = devoladaMethods.parse({ checked: false });

function open(opts: { integration?: ReturnType<typeof wisphub>; methods?: () => ReturnType<typeof ok | typeof fail> } = {}) {
  server.use(
    handlers.session(() => ok(businessActor)),
    handlers.integrations(() => ok(opts.integration ?? wisphub())),
    handlers.devoladaMethods(opts.methods ?? (() => ok(methodsBlock("found")))),
  );
  renderApp("/integrations/wisphub");
}

/* The card, by the anchor the switch's link points at */
const card = async () => {
  await screen.findByRole("heading", { name: "Formas de pago de Devolada" });
  return within(document.getElementById("formas-de-pago")!);
};
const executionSwitch = () => screen.findByLabelText("Ejecutar acciones automáticamente");
/* The connection card, where a test's own result is shown */
const connection = () => within(document.getElementById("conexion")!);
const TESTED_METHODS = "Formas de pago de Devolada en la conexión que probaste:";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("payment-method-per-channel US4: Formas de pago de Devolada", () => {
  it("both lines, each with its exact name and description, and whether it exists", async () => {
    open({ methods: () => ok(methodsBlock("found", "found")) });
    const block = await card();
    expect(await block.findByText("Pagos por link (SPEI)")).toBeInTheDocument();
    expect(block.getByText("Efectivo en la red de tiendas")).toBeInTheDocument();
    expect(block.getByText(METHOD_LINES.link.name)).toBeInTheDocument();
    expect(block.getByText(METHOD_LINES.link.description)).toBeInTheDocument();
    expect(block.getByText(METHOD_LINES.network.name)).toBeInTheDocument();
    expect(block.getByText(METHOD_LINES.network.description)).toBeInTheDocument();
    expect(block.getAllByText("Creada")).toHaveLength(2);
    expect(block.getByText("Créalas en WispHub con estos nombres exactos y no las uses para cobros en mostrador.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("each field is its own copy control: a tap copies the value in place and says Copiado", async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => {
      copied.push(text);
    });
    open();
    const block = await card();
    await userEvent.click(await block.findByRole("button", { name: /copiar el nombre/i }));
    expect(copied).toEqual([METHOD_LINES.link.name]);
    expect(await block.findByText("Copiado")).toBeInTheDocument();

    await userEvent.click(block.getByRole("button", { name: /copiar la descripción/i }));
    expect(copied).toEqual([METHOD_LINES.link.name, METHOD_LINES.link.description]);
    await expectNoViolations(document.body);
  });

  it("a copy the browser refuses never reads as copied", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    open();
    const block = await card();
    await userEvent.click(await block.findByRole("button", { name: /copiar el nombre/i }));
    const refused = await block.findByText("No se copió");
    expect(block.queryByText("Copiado")).not.toBeInTheDocument();
    /* constitution VI: the failure's ink rides with an icon, never alone */
    expect(refused.parentElement?.querySelector("svg")).not.toBeNull();
    await expectNoViolations(document.body);
  });

  it("FR-008: the network's line is not shown with the store channel off", async () => {
    open({ methods: () => ok(methodsBlock("found", null)) });
    const block = await card();
    await block.findByText(METHOD_LINES.link.name);
    expect(block.queryByText(METHOD_LINES.network.name)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("FR-008: a missing method is a setup step — observing, it says to create it to turn execution on", async () => {
    open({ methods: () => ok(methodsBlock("missing")) });
    const block = await card();
    expect(await block.findByText("Falta crearla")).toBeInTheDocument();
    expect(block.getByText("Créala para poder encender la ejecución.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("FR-008: a missing method with execution on says those payments record as cash, as today", async () => {
    open({ integration: wisphub({ actionsEnabled: true }), methods: () => ok(methodsBlock("found", "missing")) });
    const block = await card();
    expect(await block.findByText("Mientras no exista, esos pagos se registran como efectivo, igual que hoy.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("FR-003: two with one name read Repetida, and the oldest is used", async () => {
    open({ methods: () => ok(methodsBlock("duplicate")) });
    const block = await card();
    expect(await block.findByText("Repetida")).toBeInTheDocument();
    expect(block.getByText("Hay dos con este nombre; usamos la más antigua.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("FR-009: WispHub not reached is never 'missing' — it says so, offers to try again, and the switch says why it waits", async () => {
    let reads = 0;
    open({
      methods: () => {
        reads += 1;
        return ok(UNCHECKED);
      },
    });
    const block = await card();
    expect(await block.findByText("No pudimos revisar tus formas de pago en WispHub. Vuelve a intentar.")).toBeInTheDocument();
    expect(block.queryByText("Falta crearla")).not.toBeInTheDocument();
    expect(await executionSwitch()).toBeDisabled();
    /* the switch says why itself, not only the card */
    expect(document.getElementById("actions-enabled-why")).toHaveTextContent(
      "No pudimos revisar tus formas de pago en WispHub. Vuelve a intentar.",
    );
    await expectNoViolations(document.body);

    await userEvent.click(block.getByRole("button", { name: "Volver a intentar" }));
    await waitFor(() => expect(reads).toBe(2));
  });

  it("no key saved: no read, and the card says to connect first; the switch too", async () => {
    let reads = 0;
    open({
      integration: wisphub({ configured: false, keyTail: null }),
      methods: () => {
        reads += 1;
        return ok(methodsBlock("found"));
      },
    });
    const block = await card();
    expect(await block.findByText(/Conecta WispHub para revisar tus formas de pago\./)).toBeInTheDocument();
    expect(block.getByRole("link", { name: "Ir a la conexión" })).toHaveAttribute("href", "#conexion");
    expect(await executionSwitch()).toBeDisabled();
    expect(screen.getByText("Primero conecta WispHub.")).toBeInTheDocument();
    expect(reads).toBe(0);
    await expectNoViolations(document.body);
  });

  it("D14: with a method missing the switch cannot be turned on, says why and points at the block", async () => {
    open({ methods: () => ok(methodsBlock("found", "missing")) });
    await (await card()).findByText("Falta crearla");
    expect(await executionSwitch()).toBeDisabled();
    expect(screen.getByText(/Para encender la ejecución, primero crea tus formas de pago de Devolada\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver formas de pago" })).toHaveAttribute("href", "#formas-de-pago");
    await expectNoViolations(document.body);
  });

  it("FR-013: execution can always be turned off, whatever the methods", async () => {
    const patches: unknown[] = [];
    open({ integration: wisphub({ actionsEnabled: true }), methods: () => ok(methodsBlock("missing", "missing")) });
    server.use(
      handlers.patchWisphub((body) => {
        patches.push(body);
        return ok(wisphub({ actionsEnabled: false }));
      }),
    );
    const toggle = await executionSwitch();
    expect(toggle).toBeEnabled();
    await expectNoViolations(document.body);
    await userEvent.click(toggle);
    expect(patches).toEqual([{ actionsEnabled: false }]);
  });

  it.each([
    ["PAYMENT_METHODS_MISSING", 409, "Aún falta crear una forma de pago de Devolada en WispHub."],
    ["PAYMENT_METHODS_UNCHECKED", 503, "No pudimos revisar tus formas de pago en WispHub. Vuelve a intentar."],
    ["WISPHUB_NOT_CONFIGURED", 409, "Primero conecta WispHub."],
  ] as const)("D14: the API's refusal %s has its own copy", async (code, status, copy) => {
    open();
    server.use(handlers.patchWisphub(() => fail(code, status)));
    await (await card()).findByText("Creada");
    await userEvent.click(await executionSwitch());
    expect(await screen.findByText(copy, { selector: "p[role=status]" })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("U1, FR-009: a typed key's test reports its methods in the test's own result and never changes the card", async () => {
    const bodies: unknown[] = [];
    open({ methods: () => ok(methodsBlock("missing")) });
    server.use(
      handlers.testWisphubIntegration((body) => {
        bodies.push(body);
        return ok(testResult(methodsBlock("found")));
      }),
    );
    const block = await card();
    await block.findByText("Falta crearla");

    await userEvent.type(screen.getByLabelText("Nueva llave"), "otra-llave-12345");
    await userEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await screen.findByText(/Conexión correcta con wisphub\.net\./);
    expect(bodies).toEqual([{ apiKey: "otra-llave-12345" }]);
    expect(block.getByText("Falta crearla")).toBeInTheDocument();
    expect(block.queryByText("Creada")).not.toBeInTheDocument();
    /* FR-009: the test still says, for the account it tried, whether each method exists */
    const result = connection();
    expect(result.getByText(TESTED_METHODS)).toBeInTheDocument();
    expect(result.getByText(METHOD_LINES.link.name)).toBeInTheDocument();
    expect(result.getByText("Creada")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("FR-009: a typed key's test that could not read the methods says so, never missing; null says nothing", async () => {
    let answer: unknown = testResult(UNCHECKED);
    open({ methods: () => ok(methodsBlock("found")) });
    server.use(handlers.testWisphubIntegration(() => ok(answer)));
    const block = await card();
    await block.findByText("Creada");

    await userEvent.type(screen.getByLabelText("Nueva llave"), "otra-llave-12345");
    await userEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await screen.findByText(/Conexión correcta con wisphub\.net\./);
    expect(
      connection().getByText("No pudimos revisar tus formas de pago en WispHub. Vuelve a intentar."),
    ).toBeInTheDocument();
    expect(connection().queryByText("Falta crearla")).not.toBeInTheDocument();
    expect(block.getByText("Creada")).toBeInTheDocument();
    await expectNoViolations(document.body);

    answer = testResult(null);
    await userEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await waitFor(() =>
      expect(
        connection().queryByText("No pudimos revisar tus formas de pago en WispHub. Vuelve a intentar."),
      ).not.toBeInTheDocument(),
    );
    expect(connection().queryByText(TESTED_METHODS)).not.toBeInTheDocument();
  });

  it("D8: Probar conexión answering a block replaces the card's; an answer of null leaves it as it was", async () => {
    let answer: unknown = testResult(null);
    open({ methods: () => ok(methodsBlock("missing")) });
    server.use(handlers.testWisphubIntegration(() => ok(answer)));
    const block = await card();
    await block.findByText("Falta crearla");

    await userEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await screen.findByText(/Conexión correcta con wisphub\.net\./);
    expect(block.getByText("Falta crearla")).toBeInTheDocument();

    answer = testResult(methodsBlock("found"));
    await userEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    expect(await block.findByText("Creada")).toBeInTheDocument();
    expect(block.queryByText("Falta crearla")).not.toBeInTheDocument();
    /* the saved connection's block lands on the card, not twice in the result */
    expect(connection().queryByText(TESTED_METHODS)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});
