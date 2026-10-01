import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { baFail, baOk, fail, handlers, invitation, ok, searchRows, server, storeMe } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* cash-at-stores US3 (FR-009–FR-014; research D2, D3, D5) — the
   shopkeeper's way in: the phone (ten digits, however it was typed) and a
   password, or the phone's *huella o rostro*; the invitation's two steps;
   recovery by a código; and the two screens a session can end on that are
   not the sign-in — another kind of account, and a suspended store. Every
   fixture parses with the API's schema (test/msw.ts). */

const passkeys = vi.hoisted(() => ({ supported: false, result: { error: { message: "cancelled" } } as unknown }));
vi.mock("@/lib/auth-client", () => ({
  passkeysSupported: () => passkeys.supported,
  authClient: { signIn: { passkey: () => Promise.resolve(passkeys.result) } },
}));

beforeEach(() => {
  passkeys.supported = false;
  passkeys.result = { error: { message: "cancelled" } };
});
afterEach(() => server.events.removeAllListeners());

/* Signed out until a sign-in or a código says otherwise */
function signedOutUntil() {
  const state = { in: false };
  server.use(
    handlers.session(() => (state.in ? ok(storeMe) : fail("UNAUTHENTICATED", 401))),
    handlers.search(() => ok(searchRows)),
  );
  return state;
}

describe("cash-at-stores US3 — signing in", () => {
  it("sends the phone as ten digits however it was typed, and lands on the counter", async () => {
    const state = signedOutUntil();
    const sent: unknown[] = [];
    server.use(
      handlers.signIn((body) => {
        sent.push(body);
        state.in = true;
        return baOk();
      }),
    );
    const { router, container } = renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText("Teléfono"), "+52 (55) 1234-5678");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(sent).toEqual([{ username: "5512345678", password: "secreta123" }]));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByLabelText("Buscar cliente")).toBeInTheDocument();
  });

  it("never says which half was wrong", async () => {
    signedOutUntil();
    server.use(handlers.signIn(() => baFail("INVALID_USERNAME_OR_PASSWORD", 401)));
    renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText("Teléfono"), "5512345678");
    await userEvent.type(screen.getByLabelText("Contraseña"), "otra-cosa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Teléfono o contraseña incorrectos.")).toBeInTheDocument();
  });

  it("asks for ten digits before sending anything", async () => {
    signedOutUntil();
    const sent: unknown[] = [];
    server.use(
      handlers.signIn((body) => {
        sent.push(body);
        return baOk();
      }),
    );
    renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText("Teléfono"), "55 1234");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Escribe los 10 dígitos de tu teléfono.")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("a shopkeeper who never verified gets the código, which signs them in (D5)", async () => {
    const state = signedOutUntil();
    const codes: unknown[] = [];
    server.use(
      handlers.signIn(() => baFail("EMAIL_NOT_VERIFIED", 403)),
      handlers.sendCode((body) => {
        codes.push(body);
        return baOk();
      }),
      handlers.verifyEmail(() => {
        state.in = true;
        return baOk();
      }),
    );
    const { router } = renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText("Teléfono"), "5512345678");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText(/Falta verificar tu correo/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Correo de recuperación"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await waitFor(() => expect(codes).toEqual([{ email: "lupita@correo.mx", type: "email-verification" }]));
    await userEvent.type(await screen.findByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verificar y entrar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("offers huella o rostro where the phone can, and falls back in words when it fails", async () => {
    signedOutUntil();
    passkeys.supported = true;
    renderApp("/entrar");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo usar tu huella o rostro. Entra con tu teléfono y contraseña.",
    );
  });

  it("hides the passkey button where the phone cannot use one", async () => {
    signedOutUntil();
    renderApp("/entrar");
    await screen.findByLabelText("Teléfono");
    expect(screen.queryByRole("button", { name: /huella o rostro/ })).not.toBeInTheDocument();
  });
});

describe("cash-at-stores US3 — the invitation", () => {
  it("takes an email and a password, then the código that signs the shopkeeper in", async () => {
    const state = signedOutUntil();
    const accepted: unknown[] = [];
    const verified: unknown[] = [];
    server.use(
      handlers.invitation(() => ok(invitation("open"))),
      handlers.accept((body) => {
        accepted.push(body);
        return ok({ email: "lupita@correo.mx" });
      }),
      handlers.verifyEmail((body) => {
        verified.push(body);
        state.in = true;
        return baOk();
      }),
    );
    const { router, container } = renderApp("/invitacion/tok123");
    expect(await screen.findByRole("heading", { name: "Bienvenido a Devolada, Abarrotes Lupita" })).toBeInTheDocument();
    expect(screen.getByText("5678")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Correo de recuperación"), "lupita@");
    expect(screen.getByText("Escribe un correo válido, como nombre@dominio.com.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Correo de recuperación"), "correo.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "corta");
    expect(screen.getByText("Usa al menos 8 caracteres.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Contraseña"), "-y-larga");
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(accepted).toEqual([{ email: "lupita@correo.mx", password: "corta-y-larga" }]));
    expect(await screen.findByText("Te enviamos un código a lupita@correo.mx. Escríbelo para entrar.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Código"), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(verified).toEqual([{ email: "lupita@correo.mx", otp: "654321" }]));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("an email that already has an account is refused in words", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("open"))), handlers.accept(() => fail("EMAIL_TAKEN", 409)));
    renderApp("/invitacion/tok123");
    await userEvent.type(await screen.findByLabelText("Correo de recuperación"), "dueno@isp.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Ese correo ya tiene una cuenta. Usa otro.")).toBeInTheDocument();
  });

  it("a used, replaced or expired invitation says only that it no longer works", async () => {
    signedOutUntil();
    server.use(handlers.invitation(() => ok(invitation("invalid"))));
    const { container } = renderApp("/invitacion/old");
    expect(await screen.findByRole("heading", { name: "Esta invitación ya no funciona" })).toBeInTheDocument();
    expect(screen.getByText(/Pide a Devolada una invitación nueva/)).toBeInTheDocument();
    await expectNoViolations(container);
  });
});

describe("cash-at-stores US3 — recovery", () => {
  it("sends a código to the recovery email, then takes it with the new password", async () => {
    signedOutUntil();
    const codes: unknown[] = [];
    const resets: unknown[] = [];
    server.use(
      handlers.sendCode((body) => {
        codes.push(body);
        return baOk();
      }),
      handlers.resetPassword((body) => {
        resets.push(body);
        return baOk();
      }),
    );
    const { container } = renderApp("/recuperar");
    await userEvent.type(await screen.findByLabelText("Correo de recuperación"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await waitFor(() => expect(codes).toEqual([{ email: "lupita@correo.mx", type: "forget-password" }]));

    expect(await screen.findByText(/Escribe el código que enviamos a lupita@correo\.mx/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Código"), "111222");
    await userEvent.type(screen.getByLabelText("Contraseña nueva"), "nueva-clave-1");
    await expectNoViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    await waitFor(() => expect(resets).toEqual([{ email: "lupita@correo.mx", otp: "111222", password: "nueva-clave-1" }]));
    expect(await screen.findByText(/Cambiaste tu contraseña/)).toBeInTheDocument();
  });

  it("a wrong código says so and keeps the form", async () => {
    signedOutUntil();
    server.use(handlers.sendCode(() => baOk()), handlers.resetPassword(() => baFail("INVALID_OTP", 400)));
    renderApp("/recuperar");
    await userEvent.type(await screen.findByLabelText("Correo de recuperación"), "lupita@correo.mx");
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await userEvent.type(await screen.findByLabelText("Código"), "000000");
    await userEvent.type(screen.getByLabelText("Contraseña nueva"), "nueva-clave-1");
    await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText("El código no es válido o ya venció. Pide uno nuevo.")).toBeInTheDocument();
  });
});

describe("cash-at-stores US3 — the wrong account and the suspended store", () => {
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
