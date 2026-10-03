import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { act, screen, waitFor, within } from "@testing-library/react";
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

  it("«Quitar» on the key just added takes back «Listo» and offers «Activar» again (adversarial review, 2026-10-02)", async () => {
    let list: { id: string; name: string | null; createdAt: string; backedUp: boolean }[] = [];
    device.addPasskey.mockImplementation(async () => {
      list = [{ id: "pk-new", name: null, createdAt: "2026-10-02T18:00:00.000Z", backedUp: false }];
      return { data: {}, error: null };
    });
    server.use(
      ...security(() => list),
      handlers.passkeyDelete(() => {
        list = [];
        return baOk();
      }),
    );
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /quitar llave de acceso/i }));
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    expect(screen.queryByText(/ya puede entrar con huella o rostro/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar en este dispositivo" })).toBeEnabled();
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
    const switched: unknown[] = [];
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
      handlers.setActive((body) => {
        switched.push(body);
        return baOk();
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
    /* One business: the new session is born with it, and the ceremony waits for nothing more */
    expect(switched).toEqual([]);
  });

  it("a person with two businesses keeps the one they were in: the new session gets it back before the ceremony (adversarial review, 2026-10-02)", async () => {
    const twoBusinesses = {
      ...businessActor,
      id: "business-2",
      orgId: "org_business-2",
      name: "Fibra Norte",
      businesses: [...businessActor.businesses, { id: "business-2", orgId: "org_business-2", name: "Fibra Norte", role: "owner" }],
    };
    const steps: string[] = [];
    device.addPasskey.mockImplementation(async () => {
      steps.push("ceremony");
      return steps.length === 1
        ? { data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } }
        : { data: {}, error: null };
    });
    /* The switch is held open, to see what the card offers meanwhile. Inline:
       the shared handler takes no async answer. */
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.use(
      /* first: the earliest handler in one `use` wins */
      handlers.session(() => ok(twoBusinesses)),
      ...security(),
      handlers.requestCode(),
      handlers.signInCode(() => {
        steps.push("código");
        return baSignedIn();
      }),
      http.post("/auth/organization/set-active", async ({ request }) => {
        steps.push(`business ${((await request.json()) as { organizationId: string }).organizationId}`);
        await held;
        return baOk();
      }),
    );
    renderApp("/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    /* While the business comes back the step-up still confirms: no «Activar»
       to press, which would run a second ceremony beside the first */
    await waitFor(() => expect(steps).toContain("business org_business-2"));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByRole("button", { name: "Activar en este dispositivo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmando…" })).toBeDisabled();
    release();

    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar con huella o rostro\./)).toBeInTheDocument();
    expect(steps).toEqual(["ceremony", "código", "business org_business-2", "ceremony"]);
  });

  /* PasskeyCard.confirm()'s promise: a switch that fails leaves only the
     business to pick again, it never costs the person the key — so the
     step-up closes and the ceremony runs whatever set-active answered
     (adversarial review, 2026-10-03) */
  it("a business switch that fails after the código still runs the ceremony: «Listo…» shows and no step-up is left open (passwordless-access US5; adversarial review, 2026-10-03)", async () => {
    const twoBusinesses = {
      ...businessActor,
      id: "business-2",
      orgId: "org_business-2",
      name: "Fibra Norte",
      businesses: [...businessActor.businesses, { id: "business-2", orgId: "org_business-2", name: "Fibra Norte", role: "owner" }],
    };
    const steps: string[] = [];
    device.addPasskey.mockImplementation(async () => {
      steps.push("ceremony");
      return steps.length === 1
        ? { data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } }
        : { data: {}, error: null };
    });
    server.use(
      /* first: the earliest handler in one `use` wins */
      handlers.session(() => ok(twoBusinesses)),
      ...security(),
      handlers.requestCode(),
      handlers.signInCode(() => {
        steps.push("código");
        return baSignedIn();
      }),
      handlers.setActive((body) => {
        steps.push(`business ${(body as { organizationId: string }).organizationId}`);
        return baFail("INTERNAL_SERVER_ERROR", 500);
      }),
    );
    renderApp("/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar con huella o rostro\./)).toBeInTheDocument();
    /* the switch was asked, it failed, and the ceremony ran after it */
    expect(steps).toEqual(["ceremony", "código", "business org_business-2", "ceremony"]);
    expect(device.addPasskey).toHaveBeenCalledTimes(2);
    /* no step-up left open: neither its line, its field nor its buttons */
    expect(screen.queryByText(/Confirma que eres tú/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar|Confirmando/ })).not.toBeInTheDocument();
  });

  it("while the step-up's código is on its way the button says so, not that the device is asked: the ceremony is over (adversarial review, 2026-10-02)", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.use(
      ...security(),
      handlers.requestCode(async () => {
        await held;
        return baStatus({ success: true });
      }),
    );
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));

    expect(await screen.findByRole("button", { name: "Enviando el código…" })).toBeDisabled();
    expect(screen.queryByText(/Esperando a tu dispositivo/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();
    expect(device.addPasskey).toHaveBeenCalledTimes(1);
    release();

    expect(await screen.findByText(`Confirma que eres tú: te enviamos un código a ${sessionUser.email}.`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviando el código…" })).not.toBeInTheDocument();
  });

  it("a código that could not be sent opens no step-up: «Activar» is back, with why (adversarial review, 2026-10-02)", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(...security(), handlers.requestCode(() => baFail("INTERNAL_SERVER_ERROR", 500)));
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));

    expect(await screen.findByText("No pudimos enviar el código. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText(/te enviamos un código/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();

    /* "Activar" asks again, and this time the código goes out */
    server.use(handlers.requestCode(() => baTooMany()));
    await userEvent.click(screen.getByRole("button", { name: "Activar en este dispositivo" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código")).not.toBeInTheDocument();

    server.use(handlers.requestCode(() => baStatus({ success: true })));
    await userEvent.click(screen.getByRole("button", { name: "Activar en este dispositivo" }));
    expect(await screen.findByText(`Confirma que eres tú: te enviamos un código a ${sessionUser.email}.`)).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos enviar|Demasiados intentos/)).not.toBeInTheDocument();
  });

  it("a try that fails on the way is not a wrong código: the field keeps it, and «Confirmar» tries again (adversarial review, 2026-10-02)", async () => {
    device.addPasskey
      .mockResolvedValueOnce({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } })
      .mockResolvedValueOnce({ data: {}, error: null });
    server.use(...security(), handlers.requestCode(), handlers.signInCode(() => baFail("INTERNAL_SERVER_ERROR", 500)));
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este dispositivo" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("No pudimos revisar el código. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText(/no es válido/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Código")).toHaveValue("482913");
    expect(screen.getByLabelText("Código")).not.toHaveAttribute("aria-invalid");

    server.use(handlers.signInCode(() => baSignedIn()));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/Listo\. Este dispositivo ya puede entrar con huella o rostro\./)).toBeInTheDocument();
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

  it("a close that fails says so, and the button stays to try again", async () => {
    server.use(...security(), handlers.revokeOtherSessions(() => baFail("FAILED_TO_REVOKE", 500)));
    renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en los demás dispositivos" }));
    expect(await screen.findByText("No pudimos cerrar las demás sesiones. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión en los demás dispositivos" })).toBeEnabled();
    expect(screen.queryByText(/sigue con tu sesión abierta/)).not.toBeInTheDocument();
  });
});
