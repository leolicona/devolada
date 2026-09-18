import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { integrationsResponse, wisphubTestResponse } from "@devolada/api/integrations-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* docs/legacy/integrations/integrations-hub.spec.md scenarios 1, 10 and 11
   (US-I01–US-I03) — the hub's UI.

   provider-address-per-isp US1 and US2 join it below: the installation
   picker, what the screen says is in use, and the three failures that
   must read as three different problems. */

/* Validated against the contract (ARCHITECTURE.md): a fixture that
   drifts from the zod schema fails here rather than in the browser. */
const wisphub = (over: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) =>
  integrationsResponse.parse({
    wisphub: {
      provider: "wisphub",
      configured: true,
      keyTail: "1234",
      installation: "wisphub_net",
      effectiveInstallation: {
        key: "wisphub_net",
        label: "wisphub.net",
        kind: "real",
        assumed: false,
      },
      actionsEnabled: true,
      mapping: {
        exact: "register_and_reconnect",
        short: "register_and_reconnect",
        over: "register_and_reconnect",
      },
      thresholdPercent: 100,
      floorCents: 0,
      provisionalReleaseEnabled: false,
      ...over,
    },
    api: { activeCredentials: 0 },
    ...rest,
  });

/* A business that never chose: every row that predates the feature. */
const assumed = (over: Record<string, unknown> = {}) =>
  wisphub({
    installation: null,
    effectiveInstallation: { key: "wisphub_net", label: "wisphub.net", kind: "real", assumed: true },
    ...over,
  });

describe("US-I01 scenario 1: the catalog", () => {
  it("reads Sin conectar and offers Conectar; the API card is live and offers Activar (automated-collections-api US1)", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub({ configured: false, keyTail: null, actionsEnabled: false }))),
    );
    renderApp("/integrations");

    expect(await screen.findByText("Sin conectar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
    expect(screen.getByText("API de cobros")).toBeInTheDocument();
    expect(screen.getByText("Sin activar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("connected reads Conectada", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
    );
    renderApp("/integrations");
    expect(await screen.findByText("Conectada")).toBeInTheDocument();
  });
});

describe("US-I02: the detail saves the mapping and the dials", () => {
  it("saving the mapping patches the three actions with threshold and floor", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
      handlers.patchWisphub((body) => {
        patches.push(body);
        return ok(wisphub());
      }),
    );
    renderApp("/integrations/wisphub");

    /* the Label's htmlFor lands on the SelectTrigger itself */
    await userEvent.click(await screen.findByLabelText("Pago parcial"));
    await userEvent.click(await screen.findByRole("option", { name: "Solo registrar" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar mapeo" }));

    expect(patches).toEqual([
      {
        exactAction: "register_and_reconnect",
        shortAction: "register_only",
        overAction: "register_and_reconnect",
        thresholdPercent: 100,
        floorCents: 0,
      },
    ]);
  });

  it("US-I03: the master switch patches actionsEnabled on toggle", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub({ actionsEnabled: false }))),
      handlers.patchWisphub((body) => {
        patches.push(body);
        return ok(wisphub());
      }),
    );
    renderApp("/integrations/wisphub");

    await userEvent.click(await screen.findByLabelText("Ejecutar acciones automáticamente"));
    expect(patches).toEqual([{ actionsEnabled: true }]);
  });
});

describe("scenarios 10 and 11: who sees what", () => {
  it("an operator has no Integraciones section (hide, never disable)", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "operator" })),
      handlers.feed(() => ok({ payments: [], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.queryByRole("link", { name: /integraciones/i })).not.toBeInTheDocument();
  });

  it("an owner does", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.feed(() => ok({ payments: [], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.getAllByRole("link", { name: "Integraciones" }).length).toBeGreaterThan(0);
  });

  it("scenario 11: the observation chip shows for EVERY role and links to the switch", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "viewer", observing: true })),
      handlers.feed(() => ok({ payments: [], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/");
    const chips = await screen.findAllByRole("link", { name: /modo observación/i });
    expect(chips.length).toBeGreaterThan(0);
  });
});

describe("provider-address-per-isp US1: the installation is chosen and shown", () => {
  it("offers the three installations as a closed list, with the test one marked", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
    );
    renderApp("/integrations/wisphub");

    await userEvent.click(await screen.findByLabelText("¿Dónde entras a WispHub?"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "wisphub.net",
      "wisphub.io",
      /* FR-007: the sandbox says so, as icon + text, inside the choice
         itself — not only after it has been picked. */
      "Pruebas (sandbox)Pruebas",
    ]);
    /* FR-005: a closed choice. No free-text address anywhere on the screen. */
    expect(screen.queryByLabelText(/direcci[oó]n|url|host|endpoint/i)).not.toBeInTheDocument();
  });

  it("names the installation in use beside the key tail, and passes axe (FR-004)", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub({
        installation: "wisphub_io",
        effectiveInstallation: { key: "wisphub_io", label: "wisphub.io", kind: "real", assumed: false },
      }))),
    );
    renderApp("/integrations/wisphub");

    const state = (await screen.findByText("Instalación en uso:")).closest("dl")!;
    expect(within(state).getByText("wisphub.io")).toBeInTheDocument();
    /* Same block, so the address cannot be read while the key's tail is
       missed, or the other way round. */
    expect(within(state).getByText("••••1234")).toBeInTheDocument();
    /* A real installation carries no badge: the marks flag the two
       exceptions, they are not decoration. */
    expect(within(state).queryByText("Pruebas")).not.toBeInTheDocument();
    expect(within(state).queryByText("Asumida")).not.toBeInTheDocument();

    await expectNoViolations(document.body);
  });

  it("FR-002: a business that never chose still reads which one it is on, marked as assumed", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(assumed())),
    );
    renderApp("/integrations/wisphub");

    const state = (await screen.findByText("Instalación en uso:")).closest("dl")!;
    expect(within(state).getByText("wisphub.net")).toBeInTheDocument();
    expect(within(state).getByText("Asumida")).toBeInTheDocument();
    /* Said in words too, not only as a badge — and it must not read as a
       fault: nothing is broken about running on the default. */
    expect(screen.getByText(/Nadie eligió esta instalación/)).toBeInTheDocument();
  });

  it("FR-006: says plainly that an unlisted installation is asked for, never typed", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
    );
    renderApp("/integrations/wisphub");

    expect(await screen.findByText(/¿No está la tuya\?/)).toBeInTheDocument();
    expect(screen.getByText(/Escríbenos con la dirección donde entras/)).toBeInTheDocument();
  });

  it("saving a different installation on a connected business asks first, and says what is not protected", async () => {
    const patches: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
      handlers.patchWisphub((body) => {
        patches.push(body);
        return ok(wisphub({
          installation: "wisphub_io",
          effectiveInstallation: { key: "wisphub_io", label: "wisphub.io", kind: "real", assumed: false },
        }));
      }),
    );
    renderApp("/integrations/wisphub");

    await userEvent.click(await screen.findByLabelText("¿Dónde entras a WispHub?"));
    await userEvent.click(await screen.findByRole("option", { name: "wisphub.io" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar instalación" }));

    /* Nothing is saved on the click alone (/speckit-analyze finding U1) */
    expect(patches).toEqual([]);
    expect(await screen.findByText("¿Cambiar a wisphub.io?")).toBeInTheDocument();
    expect(screen.getByText(/la reconexión fallará/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cambiar instalación" }));
    expect(patches).toEqual([{ installation: "wisphub_io" }]);
  });
});

/* provider-address-per-isp US2: three failures, three messages. The
   point of the story is what each one must NOT say. */

const testResult = (over: Record<string, unknown> = {}) =>
  wisphubTestResponse.parse({
    ok: false,
    outcome: "KEY_REJECTED",
    triedInstallation: { key: "wisphub_io", label: "wisphub.io" },
    verified: [],
    unverified: ["create_invoice", "register_payment", "auto_activate", "payment_promise"],
    missingPermission: null,
    sampleCustomerCount: null,
    ...over,
  });

const showResult = (result: unknown) => {
  server.use(
    handlers.session(() => ok(businessActor)),
    handlers.integrations(() => ok(wisphub())),
    handlers.testWisphubIntegration(() => ok(result)),
  );
  renderApp("/integrations/wisphub");
};

const runTest = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Probar conexión" }));

describe("provider-address-per-isp US2: a failed connection says which thing is wrong", () => {
  it("an unreachable installation names it and says nothing about the key", async () => {
    showResult(testResult({ outcome: "INSTALLATION_UNREACHABLE" }));
    await runTest();

    expect(await screen.findByText("wisphub.io no respondió.")).toBeInTheDocument();
    /* The whole point: we learned nothing about the credential, so the
       screen must not send the owner to rotate one that is fine. */
    expect(screen.getByText(/No es tu llave/)).toBeInTheDocument();
    expect(screen.queryByText(/revisa la llave en tu panel/i)).not.toBeInTheDocument();
  });

  it("a rejected key raises the installation FIRST, not the credential", async () => {
    showResult(testResult({ outcome: "KEY_REJECTED" }));
    await runTest();

    expect(await screen.findByText("wisphub.io rechazó esta llave.")).toBeInTheDocument();
    /* The line this story exists to replace was "Revísala en tu panel"
       as the only advice. A key is valid on ONE installation, so the
       address is both likelier and cheaper to check. */
    expect(screen.getByText(/Revisa primero la instalación/)).toBeInTheDocument();
  });

  it("a missing permission never reports the connection as healthy", async () => {
    showResult(
      testResult({
        outcome: "PERMISSION_MISSING",
        verified: ["customers"],
        missingPermission: "invoices",
        sampleCustomerCount: 1,
      }),
    );
    await runTest();

    expect(
      await screen.findByText("Tu llave entra a wisphub.io, pero le falta un permiso."),
    ).toBeInTheDocument();
    expect(screen.getByText(/El permiso que falta es el de leer tus facturas/)).toBeInTheDocument();
    /* Half a connection is not a connection: nothing on screen may
       read as success. */
    expect(screen.queryByText(/Conexión correcta/)).not.toBeInTheDocument();
  });

  it("a healthy connection states what it did NOT prove (FR-011 as amended)", async () => {
    showResult(
      testResult({
        ok: true,
        outcome: "OK",
        verified: ["customers", "invoices", "payment_methods"],
        sampleCustomerCount: 3,
      }),
    );
    await runTest();

    expect(await screen.findByText("Conexión correcta con wisphub.io.")).toBeInTheDocument();
    expect(screen.getByText(/leer tus clientes, leer tus facturas, leer tus formas de pago/)).toBeInTheDocument();
    /* D7: the four writes are named, in the ISP's words, as not proven
       — with where they WILL be proven. A green badge that implied all
       seven is the silent failure this replaces. */
    expect(screen.getByText(/No comprobamos si la llave puede/)).toBeInTheDocument();
    expect(screen.getByText(/registrar un pago/)).toBeInTheDocument();
    expect(screen.getByText(/cola de acciones/)).toBeInTheDocument();
  });

  it("the answer that rides a save reads the same as a typed test (T029)", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.integrations(() => ok(wisphub())),
      handlers.patchWisphub(() =>
        ok(wisphub({}, { wisphubTest: testResult({ outcome: "KEY_REJECTED" }) })),
      ),
    );
    renderApp("/integrations/wisphub");

    await userEvent.type(await screen.findByLabelText("Nueva llave"), "01q9K2Rf.M02bG7");
    await userEvent.click(screen.getByRole("button", { name: "Guardar llave" }));

    /* Save-then-test is the path an ISP actually uses, so the three
       failures have to be tellable apart right here. */
    expect(await screen.findByText(/wisphub\.io rechazó esta llave\./)).toBeInTheDocument();
    expect(screen.getByText(/Revisa primero la instalación/)).toBeInTheDocument();
  });
});
