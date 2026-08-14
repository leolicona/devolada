import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fail as failResponse, handlers, ispActor, ok, server } from "./msw";
import { renderApp } from "./render";

/* docs/admin/shell.spec.md scenarios 2–6. */

describe("US-S04: login lands on the dashboard shell", () => {
  it("shows the four sections after login", async () => {
    server.use(
      handlers.login(() => ok({ type: "isp", id: "isp-1", name: "ISP Demo" })),
      handlers.session(() => ok(ispActor)),
    );
    const router = renderApp("/login");

    await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

    expect(await screen.findByRole("heading", { name: "Cobros" })).toBeInTheDocument();
    for (const label of ["Tiendas", "Entregas", "Configuración"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("US-S04: signup shows the verify banner with re-send", () => {
  it("lands signed-in with the banner when emailVerified is false", async () => {
    let resent = false;
    server.use(
      handlers.signup(() => ok({ type: "isp", id: "isp-1", name: "Nuevo", emailVerified: false }, 201)),
      handlers.session(() => ok({ ...ispActor, emailVerified: false })),
      handlers.resend(() => {
        resent = true;
        return ok({});
      }),
    );
    renderApp("/signup");

    await userEvent.type(await screen.findByLabelText("Nombre del ISP"), "ISP Nuevo");
    await userEvent.type(screen.getByLabelText("Correo"), "nuevo@isp.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByText(/confirma tu correo/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reenviar correo/i }));
    expect(resent).toBe(true);
  });
});

describe("D4: /verify redeems on load", () => {
  it("confirms without any tap", async () => {
    server.use(handlers.verifyEmail(() => ok({ type: "isp", id: "isp-1", emailVerified: true })));
    renderApp("/verify?token=tok-1");

    expect(await screen.findByText(/quedó confirmado/i)).toBeInTheDocument();
  });
});

describe("US-S06: recover never leaks account existence", () => {
  it("shows the same confirmation for any email", async () => {
    server.use(handlers.recover(() => ok({})));
    renderApp("/recover");

    await userEvent.type(await screen.findByLabelText("Correo"), "nadie@isp.mx");
    await userEvent.click(screen.getByRole("button", { name: /enviar enlace/i }));

    expect(await screen.findByText(/si existe una cuenta/i)).toBeInTheDocument();
  });
});

describe("D3: the guard sends session-less visits to login", () => {
  it("redirects to /login", async () => {
    server.use(handlers.session(() => failResponse("AUTHENTICATION_ERROR", 401)));
    const router = renderApp("/stores");

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
