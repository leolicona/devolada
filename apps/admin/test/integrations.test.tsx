import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/legacy/integrations/integrations-hub.spec.md scenarios 1, 10 and 11
   (US-I01–US-I03) — the hub's UI. */

const wisphub = (over: Record<string, unknown> = {}) => ({
  wisphub: {
    provider: "wisphub",
    configured: true,
    keyTail: "1234",
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
