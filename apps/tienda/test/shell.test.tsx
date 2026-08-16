import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "../src/auth/LoginForm";
import { fail, handlers, ok, server, storeActor } from "./msw";
import { renderApp } from "./render";

/* docs/store-pwa/shell.spec.md scenarios 1–5. */

describe("US-S01: store logs in with phone + password", () => {
  it("submits credentials and reports success", async () => {
    server.use(handlers.login(() => ok({ type: "store", id: "s1", name: "La Esquina" })));
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText("Teléfono"), "5512345678");
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("shows the generic error on 401 without hinting account existence", async () => {
    server.use(handlers.login(() => fail("AUTHENTICATION_ERROR", 401)));
    render(<LoginForm onSuccess={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Teléfono"), "5512345678");
    await userEvent.type(screen.getByLabelText("Contraseña"), "incorrecta99");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Teléfono o contraseña incorrectos",
    );
  });

  it("with a session, the shell renders the three tabs", async () => {
    server.use(handlers.session(() => ok(storeActor)));
    renderApp("/");

    expect(await screen.findByRole("link", { name: /cobrar/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /caja/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /movimientos/i })).toBeInTheDocument();
  });
});

describe("US-S02: the guard asks the API, it doesn't assume", () => {
  it("without a session it redirects to /login", async () => {
    server.use(
      handlers.session(() => fail("AUTHENTICATION_ERROR", 401)),
      handlers.login(() => ok({ type: "store", id: "s1", name: "La Esquina" })),
    );
    const router = renderApp("/");

    expect(await screen.findByLabelText("Teléfono")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  /* Both apps share one session cookie (better-auth.spec.md D7). An ISP
     signed in on the admin used to open the store app: /auth/me answers
     200, the tabs drew, and Caja, Movimientos and the search then all
     answered 403. */
  it("an admin's session does not open the store app", async () => {
    server.use(
      handlers.session(() =>
        ok({ type: "isp", id: "isp-1", name: "ISP Demo", email: "demo@devolada.app" }),
      ),
      handlers.login(() => ok({ type: "store", id: "s1", name: "La Esquina" })),
    );
    const router = renderApp("/");

    expect(await screen.findByLabelText("Teléfono")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.queryByRole("link", { name: /caja/i })).not.toBeInTheDocument();
  });
});

describe("US-S03: suspension takes over the app", () => {
  it("on 403 ACCOUNT_SUSPENDED the suspended screen replaces everything", async () => {
    server.use(handlers.session(() => fail("ACCOUNT_SUSPENDED", 403)));
    renderApp("/");

    expect(
      await screen.findByRole("heading", { name: "Cuenta suspendida" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /cobrar/i })).not.toBeInTheDocument();
  });
});
