import { describe, expect, it } from "vitest";
import { HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { baOk, businessActor, fail as failResponse, handlers, ok, server, sessionUser } from "./msw";
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

    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    for (const label of ["Links", "Configuración"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("US-S04: signup shows the verify banner with a código input", () => {
  it("lands on the wizard with the banner; the código confirms and can be re-sent", async () => {
    let resent = false;
    let verified = false;
    server.use(
      /* business-and-memberships D5: signup births the user only; the
         wizard (with the banner) is where the business is born */
      handlers.signup(() => ok({ type: "user", id: "user-1", name: "Nuevo", emailVerified: false }, 201)),
      handlers.session(() => failResponse("NO_BUSINESS", 403)),
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, emailVerified: false } })),
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

    await userEvent.type(await screen.findByLabelText("Tu nombre"), "Leo");
    await userEvent.type(screen.getByLabelText("Correo"), "nuevo@business.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByRole("heading", { name: /crea tu negocio/i })).toBeInTheDocument();
    expect(await screen.findByText(/confirma tu correo/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reenviar código/i }));
    expect(resent).toBe(true);

    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));
    expect(verified).toBe(true);
  });
});

describe("US-S06: recovery asks for a código and never leaks existence", () => {
  it("shows the same confirmation for any email, then takes código + new password — and restores access (scenario 7)", async () => {
    let reset = false;
    let loggedIn = false;
    server.use(
      handlers.requestReset(() => baOk()),
      handlers.resetPassword(() => {
        reset = true;
        return baOk();
      }),
      handlers.login(() => {
        loggedIn = true;
        return baOk();
      }),
      handlers.session(() => (loggedIn ? ok(businessActor) : failResponse("AUTHENTICATION_ERROR", 401))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    const router = renderApp("/recover");

    await userEvent.type(await screen.findByLabelText("Correo"), "nadie@business.mx");
    await userEvent.click(screen.getByRole("button", { name: /enviar código/i }));

    /* The confirmation names the address it went to, and both steps
       keep a way back (design review "identidad", should fix 2) */
    expect(await screen.findByText(/si existe una cuenta con nadie@business\.mx/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a iniciar sesión/i })).toHaveAttribute("href", "/login");
    /* The resend confirms, like the verify banner's does */
    await userEvent.click(screen.getByRole("button", { name: /reenviar código/i }));
    expect(await screen.findByRole("button", { name: /código reenviado/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "nueva-clave-1");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "nueva-clave-1");
    await userEvent.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    /* The new password signs the person in; the login page is not visited again */
    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(reset).toBe(true);
    expect(loggedIn).toBe(true);
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("D3: the guard sends session-less visits to login", () => {
  it("redirects to /login, remembering where you were going (D12)", async () => {
    server.use(handlers.session(() => failResponse("AUTHENTICATION_ERROR", 401)));
    const router = renderApp("/links");

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/links" });
  });

  it("login lands on the remembered page, not on the feed (D12)", async () => {
    let loggedIn = false;
    server.use(
      handlers.login(() => {
        loggedIn = true;
        return baOk();
      }),
      handlers.session(() => (loggedIn ? ok(businessActor) : failResponse("AUTHENTICATION_ERROR", 401))),
      handlers.linksRoster(() => ok({ results: [], complete: true, readAt: Date.now() })),
    );
    const router = renderApp("/login?next=/links");

    await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/links");
  });

  it("a `next` that is not a same-app path is dropped (D12: no open redirect)", async () => {
    let loggedIn = false;
    server.use(
      handlers.login(() => {
        loggedIn = true;
        return baOk();
      }),
      handlers.session(() => (loggedIn ? ok(businessActor) : failResponse("AUTHENTICATION_ERROR", 401))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    const router = renderApp("/login?next=https://evil.example");

    await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("BUG-013: the WispHub key banner points where the key lives", () => {
  it("the banner's button goes to /integrations/wisphub, not to Configuración", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, wisphubConfigured: false })),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/payments");

    expect(await screen.findByText(/falta tu llave de wisphub/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /configurar/i })).toHaveAttribute("href", "/integrations/wisphub");
  });
});

describe("US-S04: signup names each problem before the request leaves", () => {
  it("a one-letter name, a malformed email and a short password are named in place; nothing is sent", async () => {
    let requests = 0;
    server.use(
      handlers.signup(() => {
        requests += 1;
        return ok({ type: "user", id: "user-1", name: "Leo", emailVerified: false }, 201);
      }),
      handlers.session(() => failResponse("NO_BUSINESS", 403)),
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, emailVerified: false } })),
    );
    renderApp("/signup");

    await userEvent.type(await screen.findByLabelText("Tu nombre"), "L");
    await userEvent.type(screen.getByLabelText("Correo"), "leo");
    await userEvent.type(screen.getByLabelText("Contraseña"), "corta");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual([
      "Escribe tu nombre, al menos 2 letras.",
      "Escribe un correo válido, como nombre@dominio.com.",
      "Usa al menos 8 caracteres.",
    ]);
    expect(screen.getByLabelText("Tu nombre")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toBe(0);

    await userEvent.type(screen.getByLabelText("Tu nombre"), "eo");
    await userEvent.type(screen.getByLabelText("Correo"), "@business.mx");
    await userEvent.type(screen.getByLabelText("Contraseña"), "-pero-larga");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    expect(await screen.findByRole("heading", { name: /crea tu negocio/i })).toBeInTheDocument();
    expect(requests).toBe(1);
  });
});

describe("sessions rule 2 (UI): the suspended screen has a door out", () => {
  it("offers Cerrar sesión and lands on login (design review identidad, must fix 1)", async () => {
    let loggedOut = false;
    server.use(
      handlers.session(() => failResponse("ACCOUNT_SUSPENDED", 403)),
      handlers.logout(() => {
        loggedOut = true;
        return baOk();
      }),
    );
    const router = renderApp("/payments");

    expect(await screen.findByRole("heading", { name: "Cuenta suspendida" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(loggedOut).toBe(true);
    expect(router.state.location.pathname).toBe("/login");
  });
});
