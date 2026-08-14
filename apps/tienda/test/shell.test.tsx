import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { LoginForm } from "../src/auth/LoginForm";
import { router as appRouter } from "../src/router";
import { fail, handlers, ok, server, storeActor } from "./msw";

/* docs/store-pwa/shell.spec.md scenarios 1–5. */

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: appRouter.options.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

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
