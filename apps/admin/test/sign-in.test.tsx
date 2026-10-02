import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { baFail, baStatus, baTooMany, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* passwordless-access US2 (contracts/panel-access.md § /login; D6, D7): the
   key first where the browser supports passkeys, then a código for any
   address. No line about passwords (spec Clarifications, Q4). A key goes
   to `next`; a código goes through /welcome. */

const device = vi.hoisted(() => ({
  supported: vi.fn(() => true),
  canVerifyPerson: vi.fn(async () => false),
  signInPasskey: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  passkeysSupported: device.supported,
  canVerifyPerson: device.canVerifyPerson,
  authClient: { passkey: { addPasskey: vi.fn() }, signIn: { passkey: device.signInPasskey } },
}));
beforeEach(() => {
  device.supported.mockReset().mockReturnValue(true);
  device.canVerifyPerson.mockReset().mockResolvedValue(false);
  device.signInPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
});

const links = () => handlers.customers(() => ok({ results: [], nextCursor: null, matched: null, total: 0, wisphub: "ok" }));

async function askCode(email: string) {
  await userEvent.type(await screen.findByLabelText("Correo"), email);
  await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
}

describe("passwordless-access US2 — /login step 1", () => {
  it("the key first, then «o con un código» and the email; no word about passwords", async () => {
    renderApp("/login?next=/links");
    const key = await screen.findByRole("button", { name: "Entrar con huella o rostro" });
    expect(screen.getByText("o con un código")).toBeInTheDocument();
    const order = Array.from(document.querySelectorAll("button, input"));
    expect(order.indexOf(key)).toBeLessThan(order.indexOf(screen.getByLabelText("Correo")));
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", "/signup?next=%2Flinks");
    await expectNoViolations(document.body);
  });

  it("without passkey support there is no key button and no separator (FR-015)", async () => {
    device.supported.mockReturnValue(false);
    renderApp("/login");
    await screen.findByLabelText("Correo");
    expect(screen.queryByRole("button", { name: "Entrar con huella o rostro" })).not.toBeInTheDocument();
    expect(screen.queryByText("o con un código")).not.toBeInTheDocument();
  });

  it("«Enviar código» waits for an address with a valid shape", async () => {
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Correo"), "ana@negocio");
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Correo"), ".mx");
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeEnabled();
  });

  it("the key lands on `next`, typing nothing (FR-011)", async () => {
    server.use(handlers.session(() => ok(businessActor)), links());
    const router = renderApp("/login?next=/links");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(device.signInPasskey).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/links");
  });

  it("a key that fails says so in one line and offers the código (FR-012)", async () => {
    device.signInPasskey.mockResolvedValue({ data: null, error: { code: "AUTH_CANCELLED" } });
    const router = renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(await screen.findByText("No pudimos usar tu huella o rostro. Entra con un código.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("a 429 on the request says to wait (FR-027)", async () => {
    server.use(handlers.requestCode(() => baTooMany()));
    renderApp("/login");
    await askCode("ana@negocio.mx");
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
  });
});

describe("passwordless-access US2 — /login step 2: the código", () => {
  it("asks a sign-in código, names the address, and «Entrar» goes through /welcome to `next`", async () => {
    let sent: unknown = null;
    let signedIn: unknown = null;
    server.use(
      handlers.requestCode((body) => {
        sent = body;
        return baStatus({ success: true });
      }),
      handlers.signInCode((body) => {
        signedIn = body;
        return HttpResponse.json({ token: "t", user: sessionUser });
      }),
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.session(() => ok(businessActor)),
      links(),
    );
    const router = renderApp("/login?next=/links");
    await askCode("ana@negocio.mx");

    expect(await screen.findByRole("heading", { name: "Escribe tu código" })).toBeInTheDocument();
    expect(sent).toEqual({ email: "ana@negocio.mx", type: "sign-in" });
    expect(screen.getByText("Te enviamos un código de 6 dígitos a ana@negocio.mx. Vence en 10 minutos.")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ next: "/links" });
    await expectNoViolations(document.body);

    const enter = screen.getByRole("button", { name: "Entrar" });
    expect(enter).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Código"), "482913");
    await userEvent.click(enter);
    /* no name on the sign-in door: it is never this screen's to send */
    expect(signedIn).toEqual({ email: "ana@negocio.mx", otp: "482913" });
    /* /welcome: this device cannot verify the person, so straight on */
    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/links");
  });

  it("a wrong código is named; «Reenviar código» confirms; «Usar otro correo» keeps the address", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })), handlers.signInCode(() => baFail("INVALID_OTP", 400)));
    renderApp("/login");
    await askCode("ana@negocoi.mx");
    await userEvent.type(await screen.findByLabelText("Código"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("El código no es válido o ya venció. Reenvíalo e intenta otra vez.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByRole("button", { name: "Código reenviado" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Usar otro correo" }));
    expect(await screen.findByLabelText("Correo")).toHaveValue("ana@negocoi.mx");
  });

  it("a 429 on the código says to wait (FR-027)", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })), handlers.signInCode(() => baTooMany()));
    renderApp("/login");
    await askCode("ana@negocio.mx");
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
  });

  it("a person with no business yet goes on to the wizard after /welcome", async () => {
    server.use(
      handlers.requestCode(() => baStatus({ success: true })),
      handlers.signInCode(() => HttpResponse.json({ token: "t", user: sessionUser })),
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.session(() => fail("NO_BUSINESS", 403)),
    );
    renderApp("/login");
    await askCode("leo@negocio.mx");
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
  });
});

describe("passwordless-access US2 — the retired pages land on /login (D6)", () => {
  it.each(["/recover", "/verify-email"])("%s keeps `next` and drops the address an old link carries", async (page) => {
    const router = renderApp(`${page}?next=/links&email=ana%40negocio.mx`);
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/links" });
    expect(screen.getByLabelText("Correo")).toHaveValue("");
  });
});
