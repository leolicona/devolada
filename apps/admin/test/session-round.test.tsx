import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { expectNoViolations } from "./a11y";
import { baFail, baOk, baSignedIn, baStatus, baTooMany, businessActor, handlers, ok, server, sessionUser } from "./msw";
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

describe("BUG-016 / US-A05 scenario 3: the hub holds the Cerrar sesión for every role, so a phone has a door out", () => {
  it("a viewer signs out from the hub and lands on login", async () => {
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

    await screen.findByRole("heading", { name: "Cuenta" });
    expect(screen.getAllByText(businessActor.email).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }));
    expect(signedOut).toBe(true);
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});

/* passwordless-access US5 (contracts/panel-access.md § Seguridad; D8, D11,
   D12): the shared keys card, with the step-up an old session meets and
   the button that ends every other session. The client is stood in for —
   the ceremony belongs to the browser layer — as a device that can verify
   the person. */
const device = vi.hoisted(() => ({
  canVerifyPerson: vi.fn(async () => true),
  addPasskey: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  canVerifyPerson: device.canVerifyPerson,
  passkeysSupported: () => true,
  authClient: { passkey: { addPasskey: device.addPasskey }, signIn: { passkey: vi.fn() } },
}));
beforeEach(() => {
  device.canVerifyPerson.mockReset().mockResolvedValue(true);
  device.addPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
});

const security = (list: () => unknown[] = () => []) => [
  handlers.session(() => ok(businessActor)),
  handlers.settings(() => ok(settings)),
  handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
  handlers.passkeyList(() => HttpResponse.json(list())),
];

describe("US-S07 / D18 + passwordless-access US5: the keys card lists every key and removes one", () => {
  it("names the device, its date and the synced case; Quitar hits delete-passkey and the list refreshes", async () => {
    let list = [
      { id: "pk-1", name: "iPhone de Leo", createdAt: "2026-08-20T10:00:00.000Z", backedUp: true, deviceType: "multiDevice" },
      { id: "pk-2", name: null, createdAt: "2026-09-01T10:00:00.000Z", backedUp: false, deviceType: "singleDevice" },
    ];
    let deleted: unknown = null;
    server.use(
      ...security(() => list),
      handlers.passkeyDelete((body) => {
        deleted = body;
        list = list.filter((p) => p.id !== (body as { id: string }).id);
        return baOk();
      }),
    );
    renderApp("/settings/security");

    const devices = await screen.findByRole("list", { name: /dispositivos con acceso/i });
    const rows = within(devices).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/iPhone de Leo/);
    expect(rows[0]).toHaveTextContent(/sincronizada con tu llavero/i);
    expect(rows[1]).toHaveTextContent(/llave de acceso/i);
    expect(rows[1]).not.toHaveTextContent(/sincronizada/i);
    /* The copy names the synced case, so "este dispositivo" is not a half-truth */
    expect(screen.getByText(/también servirá en tus otros dispositivos/i)).toBeInTheDocument();
    /* FR-030: no password left to promise */
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    await expectNoViolations(document.body);

    await userEvent.click(within(rows[0]).getByRole("button", { name: /quitar iphone de leo/i }));
    await waitFor(() => expect(deleted).toEqual({ id: "pk-1" }));
    await screen.findByText(/llave de acceso/i);
    expect(within(screen.getByRole("list", { name: /dispositivos con acceso/i })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("with no key yet the card says so, and offers to activate one on this device", async () => {
    server.use(...security());
    renderApp("/settings/security");
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    expect(device.addPasskey).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar con huella o rostro\./)).toBeInTheDocument();
  });

  it("a device that cannot verify the person gets no activate button, and keeps the list and the sessions (FR-016)", async () => {
    device.canVerifyPerson.mockResolvedValue(false);
    server.use(...security());
    renderApp("/settings/security");
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activar en este dispositivo/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión en los demás dispositivos" })).toBeInTheDocument();
  });

  it("a cancelled activation says so, and no password is offered instead", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" } });
    server.use(...security());
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    expect(await screen.findByText("No se pudo activar. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
  });
});

describe("passwordless-access US5 — an old session confirms with a código before a key (D8)", () => {
  it("SESSION_NOT_FRESH opens the step-up; the código opens a fresh session, then the ceremony runs again", async () => {
    device.addPasskey
      .mockResolvedValueOnce({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } })
      .mockResolvedValueOnce({ data: {}, error: null });
    let asked: unknown = null;
    let entered: unknown = null;
    server.use(
      ...security(),
      handlers.requestCode((body) => {
        asked = body;
        return baStatus({ success: true });
      }),
      handlers.signInCode((body) => {
        entered = body;
        return baSignedIn();
      }),
    );
    renderApp("/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    expect(await screen.findByText(`Confirma que eres tú: te enviamos un código a ${sessionUser.email}.`)).toBeInTheDocument();
    expect(asked).toEqual({ email: sessionUser.email, type: "sign-in" });
    expect(screen.queryByRole("button", { name: "Activar en este dispositivo" })).not.toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Código"), "482913");
    await userEvent.click(confirm);

    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar con huella o rostro\./)).toBeInTheDocument();
    expect(entered).toEqual({ email: sessionUser.email, otp: "482913" });
    expect(device.addPasskey).toHaveBeenCalledTimes(2);
  });

  it("«Cancelar» closes the step-up and brings «Activar» back", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(...security(), handlers.requestCode(() => baStatus({ success: true })));
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/Confirma que eres tú/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar en este dispositivo" })).toBeInTheDocument();
  });

  it("a wrong código and a 429 are each named (FR-027)", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(...security(), handlers.requestCode(() => baStatus({ success: true })), handlers.signInCode(() => baFail("INVALID_OTP", 400)));
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    await userEvent.type(await screen.findByLabelText("Código"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/El código no es válido o ya venció\./)).toBeInTheDocument();

    server.use(handlers.signInCode(() => baTooMany()));
    await userEvent.clear(screen.getByLabelText("Código"));
    await userEvent.type(screen.getByLabelText("Código"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
  });
});

describe("passwordless-access US5 — closing the other sessions (D11, FR-022)", () => {
  it("posts revoke-other-sessions and says what it did", async () => {
    let revoked = false;
    server.use(
      ...security(),
      handlers.revokeOtherSessions(() => {
        revoked = true;
        return baStatus({ status: true });
      }),
    );
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en los demás dispositivos" }));
    expect(await screen.findByText("Listo. Solo este dispositivo sigue con tu sesión abierta.")).toBeInTheDocument();
    expect(revoked).toBe(true);
  });
});
