import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { baOk, businessActor, handlers, ok, server } from "./msw";
import { renderApp } from "./render";

/* The session round (2026-09-02): BUG-016 (a door out at every width),
   better-auth D18 (passkeys listed and removable). US-S02, US-S07. */

const settings = settingsResponse.parse({
  serviceFeeCents: 1500,
  timezone: "America/Mexico_City",
  timeFormat: "12h",
  wisphub: { configured: true, keyTail: "1234" },
  spei: { clabe: "646180157000000004", bank: "STP", beneficiaryName: null, serviceFeeCents: null, effectiveServiceFeeCents: 1500, bankUnknown: false, configured: true },
  reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
});

describe("BUG-016: Configuración holds a Cerrar sesión for every role, so a phone has a door out", () => {
  it("a viewer signs out from the Sesión card and lands on login", async () => {
    let signedOut = false;
    server.use(
      handlers.session(() => ok({ ...businessActor, role: "viewer" })),
      handlers.settings(() => ok(settings)),
      handlers.logout(() => {
        signedOut = true;
        return baOk();
      }),
    );
    const router = renderApp("/settings");

    const card = (await screen.findByRole("heading", { name: "Sesión" })).closest("div")!;
    expect(within(card).getByText(/entraste como/i)).toHaveTextContent(businessActor.email);
    await userEvent.click(within(card).getByRole("button", { name: /cerrar sesión/i }));
    expect(signedOut).toBe(true);
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("US-S07 / D18: the passkey card lists every credential and removes one", () => {
  const original = (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  beforeEach(() => {
    (window as { PublicKeyCredential?: unknown }).PublicKeyCredential = class {};
  });
  afterEach(() => {
    (window as { PublicKeyCredential?: unknown }).PublicKeyCredential = original;
  });

  it("names the device, its date and the synced case; Quitar hits delete-passkey and the list refreshes", async () => {
    let list = [
      { id: "pk-1", name: "iPhone de Leo", createdAt: "2026-08-20T10:00:00.000Z", backedUp: true, deviceType: "multiDevice" },
      { id: "pk-2", name: null, createdAt: "2026-09-01T10:00:00.000Z", backedUp: false, deviceType: "singleDevice" },
    ];
    let deleted: unknown = null;
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
      handlers.passkeyList(() => HttpResponse.json(list)),
      handlers.passkeyDelete((body) => {
        deleted = body;
        list = list.filter((p) => p.id !== (body as { id: string }).id);
        return baOk();
      }),
    );
    renderApp("/settings");

    const devices = await screen.findByRole("list", { name: /dispositivos con acceso/i });
    const rows = within(devices).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/iPhone de Leo/);
    expect(rows[0]).toHaveTextContent(/sincronizada con tu llavero/i);
    expect(rows[1]).toHaveTextContent(/llave de acceso/i);
    expect(rows[1]).not.toHaveTextContent(/sincronizada/i);
    /* The copy names the synced case, so "este dispositivo" is not a half-truth */
    expect(screen.getByText(/también servirá en tus otros dispositivos/i)).toBeInTheDocument();

    await userEvent.click(within(rows[0]).getByRole("button", { name: /quitar iphone de leo/i }));
    await waitFor(() => expect(deleted).toEqual({ id: "pk-1" }));
    await screen.findByText(/llave de acceso/i);
    expect(within(screen.getByRole("list", { name: /dispositivos con acceso/i })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("with no credential yet the card says so, and still offers to enrol", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.settings(() => ok(settings)),
      handlers.passkeyList(() => HttpResponse.json([])),
    );
    renderApp("/settings");
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activar en este dispositivo/i })).toBeInTheDocument();
  });
});
