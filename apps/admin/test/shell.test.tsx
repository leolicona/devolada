import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { baOk, fail as failResponse, handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/shell.spec.md scenarios 2–6. */

describe("US-S04: login lands on the dashboard shell", () => {
  it("shows the four sections after login", async () => {
    server.use(
      handlers.login(() => ok({ type: "business", id: "business-1", name: "ISP Demo" })),
      handlers.session(() => ok(businessActor)),
    );
    const router = renderApp("/login");

    await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

    expect(await screen.findByRole("heading", { name: "Cobros" })).toBeInTheDocument();
    for (const label of ["Links", "Configuración"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("US-S04: signup shows the verify banner with a código input", () => {
  it("lands signed-in with the banner; the código confirms and can be re-sent", async () => {
    let resent = false;
    let verified = false;
    server.use(
      handlers.signup(() => ok({ type: "business", id: "business-1", name: "Nuevo", emailVerified: false }, 201)),
      handlers.session(() => ok({ ...businessActor, emailVerified: false })),
      handlers.sendCode(() => {
        resent = true;
        return baOk();
      }),
      handlers.verifyEmail(() => {
        verified = true;
        return baOk();
      }),
    );
    renderApp("/signup");

    await userEvent.type(await screen.findByLabelText("Nombre del ISP"), "ISP Nuevo");
    await userEvent.type(screen.getByLabelText("Correo"), "nuevo@business.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByText(/confirma tu correo/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reenviar código/i }));
    expect(resent).toBe(true);

    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
    expect(verified).toBe(true);
  });
});

describe("US-S06: recovery asks for a código and never leaks existence", () => {
  it("shows the same confirmation for any email, then takes código + new password", async () => {
    let reset = false;
    server.use(
      handlers.requestReset(() => baOk()),
      handlers.resetPassword(() => {
        reset = true;
        return baOk();
      }),
    );
    const router = renderApp("/recover");

    await userEvent.type(await screen.findByLabelText("Correo"), "nadie@business.mx");
    await userEvent.click(screen.getByRole("button", { name: /enviar código/i }));

    expect(await screen.findByText(/si existe una cuenta/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await userEvent.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    expect(reset).toBe(true);
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("D3: the guard sends session-less visits to login", () => {
  it("redirects to /login", async () => {
    server.use(handlers.session(() => failResponse("AUTHENTICATION_ERROR", 401)));
    const router = renderApp("/links");

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

});
