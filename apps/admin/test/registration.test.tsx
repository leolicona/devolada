import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { baFail, baStatus, baTooMany, fail, handlers, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* passwordless-access US1 (contracts/panel-access.md § /signup): name and
   email, then the código. The account is born at the código, and nothing
   on the screen ever says an address is taken (FR-005) or asks for a
   password (FR-001). */

const device = vi.hoisted(() => ({ canVerifyPerson: vi.fn(async () => true) }));
vi.mock("@/lib/auth-client", () => ({
  canVerifyPerson: device.canVerifyPerson,
  passkeysSupported: () => true,
  authClient: { passkey: { addPasskey: vi.fn() }, signIn: { passkey: vi.fn() } },
}));
beforeEach(() => device.canVerifyPerson.mockReset().mockResolvedValue(true));

async function fillData(name: string, email: string) {
  await userEvent.type(await screen.findByLabelText("Tu nombre"), name);
  await userEvent.type(screen.getByLabelText("Correo"), email);
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("passwordless-access US1 — step 1: name and email", () => {
  it("names each problem under its field before any request leaves", async () => {
    let requests = 0;
    server.use(
      handlers.requestCode(() => {
        requests += 1;
        return baStatus({ success: true });
      }),
    );
    renderApp("/signup");
    await fillData("L", "leo");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual([
      "Escribe tu nombre, al menos 2 letras.",
      "Escribe un correo válido, como nombre@dominio.com.",
    ]);
    expect(screen.getByLabelText("Tu nombre")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toBe(0);
  });

  it("asks for a sign-in código for the address, and opens the código step", async () => {
    let sent: unknown = null;
    server.use(
      handlers.requestCode((body) => {
        sent = body;
        return baStatus({ success: true });
      }),
    );
    renderApp("/signup");
    expect(await screen.findByText("Cobra por transferencia con validación automática.")).toBeInTheDocument();
    /* asked of the rendered page: before the router's first load the
       document is empty, and the check could not fail (adversarial review,
       2026-10-02) */
    expect(screen.queryByText(/ISP/)).not.toBeInTheDocument();
    await expectNoViolations(document.body);

    await fillData("Ana López", "ana@negocio.mx");

    expect(await screen.findByRole("heading", { name: "Escribe tu código" })).toBeInTheDocument();
    expect(sent).toEqual({ email: "ana@negocio.mx", type: "sign-in" });
    expect(screen.getByText("Te enviamos un código de 6 dígitos a ana@negocio.mx. Vence en 10 minutos.")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a 429 says to wait, not that something is wrong (FR-027)", async () => {
    server.use(handlers.requestCode(() => baTooMany()));
    renderApp("/signup");
    await fillData("Ana López", "ana@negocio.mx");
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Escribe tu código" })).not.toBeInTheDocument();
  });

  it("a name over 80 letters is named under its field before any request (adversarial review, 2026-10-02)", async () => {
    let requests = 0;
    server.use(
      handlers.requestCode(() => {
        requests += 1;
        return baStatus({ success: true });
      }),
    );
    renderApp("/signup");
    const field = await screen.findByLabelText("Tu nombre");
    expect(field).toHaveAttribute("maxLength", "80");
    /* the field stops at 80; a value set past it (autofill) still meets the rule */
    fireEvent.change(field, { target: { value: "A".repeat(81) } });
    await userEvent.type(screen.getByLabelText("Correo"), "ana@negocio.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Escribe tu nombre en 80 letras o menos.")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(requests).toBe(0);
  });

  it("an address the server's check refuses is named under its field, not as a failure to retry (adversarial review, 2026-10-02)", async () => {
    let requests = 0;
    server.use(
      handlers.requestCode(() => {
        requests += 1;
        return baFail("INVALID_EMAIL", 400);
      }),
    );
    renderApp("/signup");
    await fillData("José López", "josé@negocio.mx");

    expect(await screen.findByText("Escribe un correo válido, como nombre@dominio.com.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("No pudimos enviar el código. Intenta de nuevo.")).not.toBeInTheDocument();
    expect(requests).toBe(1);

    /* an edit clears it */
    await userEvent.clear(screen.getByLabelText("Correo"));
    await userEvent.type(screen.getByLabelText("Correo"), "jose@negocio.mx");
    expect(screen.queryByText("Escribe un correo válido, como nombre@dominio.com.")).not.toBeInTheDocument();
  });
});

describe("passwordless-access US1 — step 2: the código", () => {
  it("«Crear cuenta» waits for six digits, then sends the name with the código, and goes to /welcome keeping `next`", async () => {
    let signedIn: unknown = null;
    server.use(
      handlers.requestCode(() => baStatus({ success: true })),
      handlers.signInCode((body) => {
        signedIn = body;
        return HttpResponse.json({ token: "t", user: { ...sessionUser, name: "Ana López", email: "ana@negocio.mx" } });
      }),
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: "Ana López", email: "ana@negocio.mx" } })),
      /* a new account has no business yet; /welcome reads it as the shell does */
      handlers.session(() => fail("NO_BUSINESS", 403)),
    );
    const router = renderApp("/signup?next=/links");
    await fillData("Ana López", "ana@negocio.mx");

    const create = await screen.findByRole("button", { name: "Crear cuenta" });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Código"), "48291");
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Código"), "3");
    await userEvent.click(create);

    expect(signedIn).toEqual({ email: "ana@negocio.mx", otp: "482913", name: "Ana López" });
    /* /welcome: the device can verify the person, so the offer is there */
    expect(await screen.findByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    expect(router.state.location.search).toEqual({ next: "/links" });
  });

  it("a wrong or dead código is named once, the same for each way it can fail", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })));
    renderApp("/signup");
    await fillData("Ana López", "ana@negocio.mx");
    await screen.findByRole("heading", { name: "Escribe tu código" });

    for (const [code, status] of [
      ["INVALID_OTP", 400],
      ["OTP_EXPIRED", 400],
      ["TOO_MANY_ATTEMPTS", 403],
    ] as const) {
      server.use(handlers.signInCode(() => baFail(code, status)));
      await userEvent.clear(screen.getByLabelText("Código"));
      await userEvent.type(screen.getByLabelText("Código"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
      expect(await screen.findByText("El código no es válido o ya venció. Reenvíalo e intenta otra vez.")).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Código")).toHaveAttribute("aria-invalid", "true");
  });

  it("a 429 on the código says to wait (FR-027)", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })), handlers.signInCode(() => baTooMany()));
    renderApp("/signup");
    await fillData("Ana López", "ana@negocio.mx");
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
  });

  it("«Reenviar código» asks again and says «Código reenviado»", async () => {
    let requests = 0;
    server.use(
      handlers.requestCode(() => {
        requests += 1;
        return baStatus({ success: true });
      }),
    );
    renderApp("/signup");
    await fillData("Ana López", "ana@negocio.mx");
    await userEvent.click(await screen.findByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByRole("button", { name: "Código reenviado" })).toBeInTheDocument();
    await waitFor(() => expect(requests).toBe(2));
  });

  it("«Usar otro correo» goes back to step 1 with the address kept for editing", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })));
    renderApp("/signup");
    await fillData("Ana López", "ana@negocoi.mx");
    await userEvent.click(await screen.findByRole("button", { name: "Usar otro correo" }));
    expect(await screen.findByRole("heading", { name: "Crear cuenta" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveValue("ana@negocoi.mx");
    expect(screen.getByLabelText("Tu nombre")).toHaveValue("Ana López");
  });
});

describe("passwordless-access US1 — what the registration never shows (FR-001, FR-005, FR-030)", () => {
  it("no password field, no «ya existe una cuenta», no business type — in either step", async () => {
    server.use(handlers.requestCode(() => baStatus({ success: true })));
    renderApp("/signup");
    await screen.findByLabelText("Tu nombre");
    const never = () => {
      expect(document.querySelector('input[type="password"]')).toBeNull();
      expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/ya existe una cuenta/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\bISP\b/)).not.toBeInTheDocument();
    };
    never();
    await fillData("Ana López", "dueno@negocio.mx");
    await screen.findByRole("heading", { name: "Escribe tu código" });
    never();
  });
});
