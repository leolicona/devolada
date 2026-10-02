import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import {
  baFail,
  baOk,
  baTooMany,
  cashbox,
  fail,
  handoverList,
  handlers,
  invitation,
  invitationAccepted,
  invitationCodeSent,
  ok,
  searchRows,
  server,
  signedIn,
  signInCodeSent,
  storeMe,
  tooMany,
} from "./msw";
import { atWidth, renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US3 (FR-009–FR-014; research D2, D3) and
   passwordless-access US6 (contracts/store-access.md § UI; research D7,
   D8, D10–D12; FR-031–FR-036) — the shopkeeper's way in without a
   password: the phone's *huella o rostro*, or the store's phone and a
   código sent to the store's email; the invitation's three steps (the
   email, its código, the key); /recuperar landing on /entrar; Caja's keys
   card with its list, the step-up and the close-others button; and the two
   screens a session can end on that are not the sign-in — another kind of
   account, and a suspended store. Every fixture parses with the API's
   schema (test/msw.ts). The Better Auth client is stood in for: the
   ceremonies belong to the passkey layer (tests/passkey). */

const device = vi.hoisted(() => ({
  supported: vi.fn(() => false),
  canVerifyPerson: vi.fn(async () => false),
  signInPasskey: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: { code: "AUTH_CANCELLED" } })),
  addPasskey: vi.fn(async (_opts?: unknown): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  passkeysSupported: device.supported,
  canVerifyPerson: device.canVerifyPerson,
  authClient: { passkey: { addPasskey: device.addPasskey }, signIn: { passkey: device.signInPasskey } },
}));

beforeEach(() => {
  device.supported.mockReset().mockReturnValue(false);
  device.canVerifyPerson.mockReset().mockResolvedValue(false);
  device.signInPasskey.mockReset().mockResolvedValue({ data: null, error: { code: "AUTH_CANCELLED" } });
  device.addPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
});
afterEach(() => server.events.removeAllListeners());

const TOO_MANY = "Demasiados intentos. Espera un momento e intenta de nuevo.";
const SAME_FOR_ANY_PHONE = "Si ese teléfono es de una tienda, te enviamos un código al correo de la tienda. Vence en 10 minutos.";

/* Signed out until a door says otherwise */
function signedOutUntil() {
  const state = { in: false };
  server.use(
    handlers.session(() => (state.in ? ok(storeMe) : fail("UNAUTHENTICATED", 401))),
    handlers.search(() => ok(searchRows)),
  );
  return state;
}

async function askCode(phone: string) {
  await userEvent.type(await screen.findByLabelText("Tu teléfono"), phone);
  await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
}

async function typeCode(code: string) {
  await userEvent.type(await screen.findByLabelText("Código"), code);
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("passwordless-access US6 — /entrar step 1", () => {
  it("the key first, then «o con un código» and the phone; no word about passwords (spec Clarifications, Q4)", async () => {
    signedOutUntil();
    device.supported.mockReturnValue(true);
    const { container } = renderApp("/entrar");
    const key = await screen.findByRole("button", { name: "Entrar con huella o rostro" });
    expect(screen.getByText("o con un código")).toBeInTheDocument();
    const order = Array.from(document.querySelectorAll("button, input"));
    expect(order.indexOf(key)).toBeLessThan(order.indexOf(screen.getByLabelText("Tu teléfono")));
    expect(key).toHaveClass("bg-accent");
    expect(screen.getByRole("button", { name: "Enviar código" })).not.toHaveClass("bg-accent");
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /olvidé/i })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("without passkey support there is no key button and no separator, and «Enviar código» is the primary", async () => {
    signedOutUntil();
    const { container } = renderApp("/entrar");
    await screen.findByLabelText("Tu teléfono");
    expect(screen.queryByRole("button", { name: /huella o rostro/ })).not.toBeInTheDocument();
    expect(screen.queryByText("o con un código")).not.toBeInTheDocument();
    /* the primary's fill (packages/ui Button), not the secondary's border */
    expect(screen.getByRole("button", { name: "Enviar código" })).toHaveClass("bg-accent");
    await expectNoViolations(container);
  });

  it("the key lands on the counter, typing nothing (FR-011)", async () => {
    const state = signedOutUntil();
    device.supported.mockReturnValue(true);
    device.signInPasskey.mockImplementation(async () => {
      state.in = true;
      return { data: {}, error: null };
    });
    const { router } = renderApp("/entrar");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
  });

  it("a key that fails says so in one line and keeps the código right below (analysis A4)", async () => {
    signedOutUntil();
    device.supported.mockReturnValue(true);
    const { router } = renderApp("/entrar");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(await screen.findByText("No se pudo usar tu huella o rostro. Entra con un código.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu teléfono")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/entrar");
  });

  it("sends the phone as ten digits however it was typed (cash-at-stores D3)", async () => {
    signedOutUntil();
    const sent: unknown[] = [];
    server.use(
      handlers.signInCode((body) => {
        sent.push(body);
        return ok(signInCodeSent);
      }),
    );
    renderApp("/entrar");
    await askCode("+52 (55) 1234-5678");
    expect(await screen.findByRole("heading", { name: "Escribe el código" })).toBeInTheDocument();
    expect(sent).toEqual([{ phone: "5512345678" }]);
  });

  it("asks for ten digits before sending anything", async () => {
    signedOutUntil();
    const sent: unknown[] = [];
    server.use(
      handlers.signInCode((body) => {
        sent.push(body);
        return ok(signInCodeSent);
      }),
    );
    renderApp("/entrar");
    await askCode("55 1234");
    expect(await screen.findByText("Escribe los 10 dígitos de tu teléfono.")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("a 429 on the request says to wait (FR-027)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode(() => tooMany()));
    renderApp("/entrar");
    await askCode("5512345678");
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Escribe el código" })).not.toBeInTheDocument();
  });

  it("a lost signal says so, never a wrong number (cash-at-stores T074)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode(() => HttpResponse.error()));
    renderApp("/entrar");
    await askCode("5512345678");
    expect(await screen.findByText("Sin conexión. Revisa tu internet e intenta de nuevo.")).toBeInTheDocument();
  });
});

describe("passwordless-access US6 — /entrar step 2: the código", () => {
  it("says the same for any phone, and «Usar otro teléfono» goes back with the number kept (FR-033)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode());
    const { container } = renderApp("/entrar");
    await askCode("5512345678");
    expect(await screen.findByText(SAME_FOR_ANY_PHONE)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Usar otro teléfono" }));
    const phone = await screen.findByLabelText("Tu teléfono");
    expect(phone).toHaveValue("5512345678");
    await userEvent.clear(phone);
    await askCode("3398765432");
    expect(await screen.findByText(SAME_FOR_ANY_PHONE)).toBeInTheDocument();
  });

  it("«Reenviar código» asks again and confirms with «Código reenviado»", async () => {
    signedOutUntil();
    const sent: unknown[] = [];
    server.use(
      handlers.signInCode((body) => {
        sent.push(body);
        return ok(signInCodeSent);
      }),
    );
    renderApp("/entrar");
    await askCode("5512345678");
    await userEvent.click(await screen.findByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByRole("button", { name: "Código reenviado" })).toBeInTheDocument();
    expect(sent).toEqual([{ phone: "5512345678" }, { phone: "5512345678" }]);
  });

  it("«Entrar» waits for six digits and sends the phone with the código; a device that can verify the person is offered the key, then the counter", async () => {
    const state = signedOutUntil();
    device.canVerifyPerson.mockResolvedValue(true);
    let tried: unknown = null;
    server.use(
      handlers.signInCode(),
      handlers.signIn((body) => {
        tried = body;
        state.in = true;
        return ok(signedIn);
      }),
    );
    const { router, container } = renderApp("/entrar");
    await askCode("55 1234 5678");
    const enter = await screen.findByRole("button", { name: "Entrar" });
    expect(enter).toBeDisabled();
    await typeCode("482913");
    expect(tried).toEqual({ phone: "5512345678", otp: "482913" });

    expect(await screen.findByRole("heading", { level: 1, name: "Entra la próxima vez con tu huella o rostro" })).toBeInTheDocument();
    expect(screen.getByText(/Si otras personas desbloquean este teléfono/)).toBeInTheDocument();
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Activar huella o rostro" }));
    expect(device.addPasskey).toHaveBeenCalledWith({ name: "Tienda" });
    expect(await screen.findByText("Listo.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
  });

  it("«Ahora no» goes to the counter without a key", async () => {
    const state = signedOutUntil();
    device.canVerifyPerson.mockResolvedValue(true);
    server.use(
      handlers.signInCode(),
      handlers.signIn(() => {
        state.in = true;
        return ok(signedIn);
      }),
    );
    const { router } = renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("482913");
    await userEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(device.addPasskey).not.toHaveBeenCalled();
  });

  it("on a computer the offer names «esta computadora» (cash-at-stores D32)", async () => {
    atWidth(1280);
    const state = signedOutUntil();
    device.canVerifyPerson.mockResolvedValue(true);
    server.use(
      handlers.signInCode(),
      handlers.signIn(() => {
        state.in = true;
        return ok(signedIn);
      }),
    );
    renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("482913");
    expect(await screen.findByText(/Si otras personas desbloquean esta computadora/)).toBeInTheDocument();
  });

  it("a device that cannot verify the person goes straight to the counter (D7)", async () => {
    const state = signedOutUntil();
    server.use(
      handlers.signInCode(),
      handlers.signIn(() => {
        state.in = true;
        return ok(signedIn);
      }),
    );
    const { router } = renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("482913");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("button", { name: "Activar huella o rostro" })).not.toBeInTheDocument();
  });

  it("a wrong, dead or exhausted código is one line, alike for a phone that names no store (FR-033)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode(), handlers.signIn(() => fail("INVALID_OTP", 400)));
    renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("000000");
    expect(await screen.findByText("El código no es válido o ya venció. Pide uno nuevo.")).toBeInTheDocument();
    expect(screen.getByLabelText("Código")).toHaveAttribute("aria-invalid", "true");

    server.use(handlers.signIn(() => fail("TOO_MANY_ATTEMPTS", 403)));
    await userEvent.clear(screen.getByLabelText("Código"));
    await typeCode("111111");
    expect(await screen.findByText("El código no es válido o ya venció. Pide uno nuevo.")).toBeInTheDocument();
  });

  it("a 429 on the try and on the resend says to wait (FR-027)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode(), handlers.signIn(() => tooMany()));
    renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("482913");
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();

    server.use(handlers.signInCode(() => tooMany()));
    await userEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeInTheDocument();
  });

  it("a suspended store's código opens the suspended screen (FR-014)", async () => {
    signedOutUntil();
    server.use(handlers.signInCode(), handlers.signIn(() => fail("STORE_SUSPENDED", 403)));
    renderApp("/entrar");
    await askCode("5512345678");
    await typeCode("482913");
    expect(await screen.findByRole("heading", { name: "Tu tienda está suspendida" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver a entrar" }));
    expect(await screen.findByLabelText("Tu teléfono")).toBeInTheDocument();
  });
});

describe("passwordless-access US6 — the invitation's three steps (D10)", () => {
  it("the email, its código, then the key; each step's body is what the contract says", async () => {
    const state = signedOutUntil();
    device.canVerifyPerson.mockResolvedValue(true);
    const asked: unknown[] = [];
    const accepted: unknown[] = [];
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.invitationCode((body, token) => {
        asked.push({ body, token });
        return ok(invitationCodeSent());
      }),
      handlers.accept((body, token) => {
        accepted.push({ body, token });
        state.in = true;
        return ok(invitationAccepted, 201);
      }),
    );
    const { router, container } = renderApp("/invitacion/tok123");
    expect(await screen.findByRole("heading", { name: "Bienvenido a Devolada, Abarrotes Lupita" })).toBeInTheDocument();
    expect(screen.getByText("Entrarás con tu huella o rostro, o con un código que te enviamos a tu correo.")).toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Tu correo"), "lupita@correo.mx");
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Escribe el código" })).toBeInTheDocument();
    expect(asked).toEqual([{ body: { email: "lupita@correo.mx" }, token: "tok123" }]);
    expect(screen.getByText("Te enviamos un código a lupita@correo.mx. Vence en 10 minutos.")).toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByRole("button", { name: "Código reenviado" })).toBeInTheDocument();
    expect(asked).toHaveLength(2);

    await typeCode("654321");
    expect(await screen.findByRole("heading", { level: 1, name: "Entra la próxima vez con tu huella o rostro" })).toBeInTheDocument();
    expect(accepted).toEqual([{ body: { email: "lupita@correo.mx", otp: "654321" }, token: "tok123" }]);
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Activar huella o rostro" }));
    expect(device.addPasskey).toHaveBeenCalledWith({ name: "Tienda" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
  });

  it("«Usar otro correo» goes back with the address kept", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("open"))), handlers.invitationCode());
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Usar otro correo" }));
    expect(await screen.findByLabelText("Tu correo")).toHaveValue("lupita@correo.mx");
  });

  it("a malformed address is named before anything is sent", async () => {
    signedOutUntil();
    const asked: unknown[] = [];
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.invitationCode((body) => {
        asked.push(body);
        return ok(invitationCodeSent());
      }),
    );
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@");
    await userEvent.tab();
    expect(screen.getByText("Escribe un correo válido, como nombre@dominio.com.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect(asked).toEqual([]);
  });

  it("an address that has an account is named only after its código, and goes back to step 1 (FR-032)", async () => {
    signedOutUntil();
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.invitationCode(() => ok(invitationCodeSent("dueno@isp.mx"))),
      handlers.accept(() => fail("EMAIL_TAKEN", 409)),
    );
    const { container } = renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "dueno@isp.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Escribe el código" })).toBeInTheDocument();
    expect(screen.queryByText(/ya tiene una cuenta/)).not.toBeInTheDocument();
    await typeCode("482913");

    expect(await screen.findByText("Ese correo ya tiene una cuenta en Devolada. Usa otro para tu tienda.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bienvenido a Devolada, Abarrotes Lupita" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tu correo")).toHaveValue("dueno@isp.mx");
    await expectNoViolations(container);
  });

  it("an invitation that dies between the steps shows the invalid screen", async () => {
    signedOutUntil();
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.invitationCode(),
      handlers.accept(() => fail("INVALID_INVITATION", 400)),
    );
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await typeCode("482913");
    expect(await screen.findByRole("heading", { name: "Esta invitación ya no funciona" })).toBeInTheDocument();
  });

  it("the código request on a dead invitation shows the invalid screen too", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("open"))), handlers.invitationCode(() => fail("INVALID_INVITATION", 400)));
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Esta invitación ya no funciona" })).toBeInTheDocument();
  });

  it("a used, replaced or expired invitation says only that it no longer works", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("invalid"))));
    const { container } = renderApp("/invitacion/old");
    expect(await screen.findByRole("heading", { name: "Esta invitación ya no funciona" })).toBeInTheDocument();
    expect(screen.getByText(/Pide a Devolada una invitación nueva/)).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("a wrong código is one line, and a 429 on either step says to wait (FR-027)", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("open"))), handlers.invitationCode(() => tooMany()));
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();

    server.use(handlers.invitationCode(), handlers.accept(() => fail("OTP_EXPIRED", 400)));
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await typeCode("482913");
    expect(await screen.findByText("El código no es válido o ya venció. Pide uno nuevo.")).toBeInTheDocument();

    server.use(handlers.accept(() => tooMany()));
    await userEvent.clear(screen.getByLabelText("Código"));
    await typeCode("111111");
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();

    /* and on «Reenviar código»: the resend takes back its «Código reenviado» */
    server.use(handlers.invitationCode(() => tooMany()));
    await userEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeInTheDocument();
  });

  it("a device that cannot verify the person goes straight to the counter (D7)", async () => {
    const state = signedOutUntil();
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.invitationCode(),
      handlers.accept(() => {
        state.in = true;
        return ok(invitationAccepted, 201);
      }),
    );
    const { router } = renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Tu correo"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await typeCode("482913");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("button", { name: "Activar huella o rostro" })).not.toBeInTheDocument();
  });
});

describe("passwordless-access US6 — /recuperar (D10)", () => {
  it("lands on /entrar: there is no password to recover", async () => {
    signedOutUntil();
    const { router, container } = renderApp("/recuperar");
    expect(await screen.findByLabelText("Tu teléfono")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/entrar");
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe("passwordless-access US6 — Caja's keys card (D8, D11, D12; FR-036)", () => {
  const caja = (list: () => unknown[] = () => []) => [
    handlers.session(() => ok(storeMe)),
    handlers.cashbox(() => ok(cashbox())),
    handlers.passkeyList(() => HttpResponse.json(list())),
  ];

  it("lists every key, and «Quitar» removes one and refreshes the list", async () => {
    let list = [
      { id: "pk-1", name: "Tienda", createdAt: "2026-09-20T10:00:00.000Z", backedUp: true },
      { id: "pk-2", name: null, createdAt: "2026-09-28T10:00:00.000Z", backedUp: false },
    ];
    let removed: unknown = null;
    server.use(
      ...caja(() => list),
      handlers.passkeyDelete((body) => {
        removed = body;
        list = list.filter((k) => k.id !== body.id);
        return baOk();
      }),
    );
    const { container } = renderApp("/caja");
    const devices = await screen.findByRole("list", { name: /dispositivos con acceso/i });
    const rows = within(devices).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Tienda/);
    expect(rows[0]).toHaveTextContent(/sincronizada con tu llavero/i);
    expect(rows[1]).toHaveTextContent(/llave de acceso/i);
    /* FR-035: no password left to promise */
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    await expectNoViolations(container);

    await userEvent.click(within(rows[0]).getByRole("button", { name: /quitar tienda/i }));
    await waitFor(() => expect(removed).toEqual({ id: "pk-1" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: /dispositivos con acceso/i })).getAllByRole("listitem")).toHaveLength(1));
  });

  it("a «Quitar» that fails says so", async () => {
    server.use(
      ...caja(() => [{ id: "pk-1", name: "Tienda", createdAt: "2026-09-20T10:00:00.000Z", backedUp: false }]),
      handlers.passkeyDelete(() => baFail("PASSKEY_NOT_FOUND", 404)),
    );
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: /quitar tienda/i }));
    expect(await screen.findByText("No pudimos quitar esa llave. Intenta de nuevo.")).toBeInTheDocument();
  });

  it("offers «Activar en este teléfono» where the device can verify the person, named «Tienda»", async () => {
    device.canVerifyPerson.mockResolvedValue(true);
    server.use(...caja());
    renderApp("/caja");
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este teléfono" }));
    expect(device.addPasskey).toHaveBeenCalledWith({ name: "Tienda" });
    expect(await screen.findByText("Listo. Este teléfono ya puede entrar con huella o rostro.")).toBeInTheDocument();
  });

  it("on a computer it says «esta computadora» (cash-at-stores D32)", async () => {
    atWidth(1280);
    device.canVerifyPerson.mockResolvedValue(true);
    server.use(...caja(), handlers.handovers(() => ok(handoverList([]))));
    renderApp("/caja");
    expect(await screen.findByRole("button", { name: "Activar en esta computadora" })).toBeInTheDocument();
  });

  it("a device that cannot verify the person keeps the list and the close-others button, without «Activar» (D7)", async () => {
    server.use(...caja());
    renderApp("/caja");
    expect(await screen.findByText(/ningún dispositivo tiene acceso/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activar en/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión en los demás dispositivos" })).toBeInTheDocument();
  });

  it("an old session confirms with a código sent to /auth/me's email, then the ceremony runs again (D8)", async () => {
    device.canVerifyPerson.mockResolvedValue(true);
    device.addPasskey
      .mockResolvedValueOnce({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } })
      .mockResolvedValueOnce({ data: {}, error: null });
    let asked: unknown = null;
    let entered: unknown = null;
    server.use(
      ...caja(),
      handlers.stepUpCode((body) => {
        asked = body;
        return HttpResponse.json({ success: true });
      }),
      handlers.stepUpSignIn((body) => {
        entered = body;
        return HttpResponse.json({ token: "t", user: { id: "user-1" } });
      }),
    );
    const { container } = renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este teléfono" }));
    expect(await screen.findByText(`Confirma que eres tú: te enviamos un código a ${storeMe.email}.`)).toBeInTheDocument();
    expect(asked).toEqual({ email: storeMe.email, type: "sign-in" });
    expect(screen.queryByRole("button", { name: "Activar en este teléfono" })).not.toBeInTheDocument();
    await expectNoViolations(container);

    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Código"), "482913");
    await userEvent.click(confirm);
    expect(await screen.findByText("Listo. Este teléfono ya puede entrar con huella o rostro.")).toBeInTheDocument();
    expect(entered).toEqual({ email: storeMe.email, otp: "482913" });
    expect(device.addPasskey).toHaveBeenCalledTimes(2);
  });

  it("«Cancelar» closes the step-up and brings «Activar» back", async () => {
    device.canVerifyPerson.mockResolvedValue(true);
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(...caja(), handlers.stepUpCode());
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este teléfono" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/Confirma que eres tú/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar en este teléfono" })).toBeInTheDocument();
  });

  it("the step-up names a wrong código, and a 429 on its request or its try says to wait (FR-027)", async () => {
    device.canVerifyPerson.mockResolvedValue(true);
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(...caja(), handlers.stepUpCode(() => baTooMany()));
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este teléfono" }));
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    server.use(handlers.stepUpCode(), handlers.stepUpSignIn(() => baFail("INVALID_OTP", 400)));
    await userEvent.click(await screen.findByRole("button", { name: "Activar en este teléfono" }));
    await userEvent.type(await screen.findByLabelText("Código"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("El código no es válido o ya venció. Pide uno nuevo.")).toBeInTheDocument();

    server.use(handlers.stepUpSignIn(() => baTooMany()));
    await userEvent.clear(screen.getByLabelText("Código"));
    await userEvent.type(screen.getByLabelText("Código"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(TOO_MANY)).toBeInTheDocument();
  });

  it("«Cerrar sesión en los demás dispositivos» posts revoke-other-sessions and says what it did (D11)", async () => {
    let revoked = false;
    server.use(
      ...caja(),
      handlers.revokeOtherSessions(() => {
        revoked = true;
        return HttpResponse.json({ status: true });
      }),
    );
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en los demás dispositivos" }));
    expect(await screen.findByText("Listo. Solo este teléfono sigue con tu sesión abierta.")).toBeInTheDocument();
    expect(revoked).toBe(true);
  });

  it("on a computer the close-others line names «esta computadora» (cash-at-stores D32)", async () => {
    atWidth(1280);
    server.use(...caja(), handlers.handovers(() => ok(handoverList([]))), handlers.revokeOtherSessions());
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en los demás dispositivos" }));
    expect(await screen.findByText("Listo. Solo esta computadora sigue con tu sesión abierta.")).toBeInTheDocument();
  });

  it("a close that fails says so, and the button stays to try again", async () => {
    server.use(...caja(), handlers.revokeOtherSessions(() => baFail("FAILED_TO_REVOKE", 500)));
    renderApp("/caja");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en los demás dispositivos" }));
    expect(await screen.findByText("No pudimos cerrar las demás sesiones. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión en los demás dispositivos" })).toBeEnabled();
  });
});

describe("cash-at-stores US3 — staying in through a weak signal (T074, FR-010, D26)", () => {
  it("a session read that cannot reach the API keeps the app, offers a retry, and never shows the sign-in", async () => {
    let reachable = false;
    server.use(
      handlers.session(() => (reachable ? ok(storeMe) : HttpResponse.error())),
      handlers.search(() => ok(searchRows)),
    );
    const { container } = renderApp("/");
    expect(await screen.findByText(/No pudimos cargar tu tienda/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu teléfono")).toBeNull();
    await expectNoViolations(container);
    reachable = true;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Cobrar" })).toBeInTheDocument();
  });

  it("a server error on the session read does not sign the shopkeeper out of view either", async () => {
    server.use(handlers.session(() => fail("INTERNAL_ERROR", 503)));
    renderApp("/");
    expect(await screen.findByText(/No pudimos cargar tu tienda/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu teléfono")).toBeNull();
  });
});

describe("cash-at-stores US3 + passwordless-access US6 — the wrong account and the suspended store, unchanged", () => {
  it("a business member's account gets its own screen and a way out (FR-013)", async () => {
    let signedOut = false;
    server.use(
      handlers.session(() => (signedOut ? fail("UNAUTHENTICATED", 401) : ok({ type: "business", id: "business-1" }))),
      handlers.signOut(),
    );
    server.events.on("request:start", ({ request }) => {
      if (request.url.endsWith("/auth/sign-out")) signedOut = true;
    });
    const { router, container } = renderApp("/");
    expect(await screen.findByRole("heading", { name: "Esta cuenta no es de una tienda" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar cliente")).not.toBeInTheDocument();
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(signedOut).toBe(true);
  });

  it("a suspended store says so and offers no counter (FR-014)", async () => {
    server.use(handlers.session(() => fail("STORE_SUSPENDED", 403)));
    const { container } = renderApp("/caja");
    expect(await screen.findByRole("heading", { name: "Tu tienda está suspendida" })).toBeInTheDocument();
    expect(screen.getByText(/no puedes cobrar ni entrar/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Secciones" })).not.toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("a store suspended mid-session lands on the same screen at its next action", async () => {
    server.use(handlers.session(() => ok(storeMe)), handlers.search(() => fail("STORE_SUSPENDED", 403)));
    renderApp("/");
    await userEvent.type(await screen.findByLabelText("Buscar cliente"), "guadalupe");
    expect(await screen.findByRole("heading", { name: "Tu tienda está suspendida" })).toBeInTheDocument();
  });
});
