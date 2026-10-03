import { describe, expect, it } from "vitest";
import { HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { baOk, baSignedIn, baStatus, businessActor, fail as failResponse, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* docs/legacy/admin/shell.spec.md scenarios 2–6.

   passwordless-access US2: the password login, the signup, the código
   screen and the recovery moved to sign-in.test.tsx, registration.test.tsx
   and welcome.test.tsx; the guard signs in with a código here. Devices in
   happy-dom cannot verify the person (no PublicKeyCredential), so /welcome
   goes straight on (D7). */

async function signInByCode() {
  await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
  await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
  await userEvent.type(await screen.findByLabelText("Código"), "482913");
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("D3: the guard sends session-less visits to login", () => {
  it("redirects to /login, remembering where you were going (D12)", async () => {
    server.use(handlers.session(() => failResponse("AUTHENTICATION_ERROR", 401)));
    const router = renderApp("/links");

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/links" });
  });

  it("the código lands on the remembered page, not on the feed (D12; passwordless-access US2)", async () => {
    let loggedIn = false;
    server.use(
      handlers.requestCode(() => baStatus({ success: true })),
      handlers.signInCode(() => {
        loggedIn = true;
        return baSignedIn();
      }),
      handlers.getSession(() => HttpResponse.json(loggedIn ? { user: sessionUser } : null)),
      handlers.session(() => (loggedIn ? ok(businessActor) : failResponse("AUTHENTICATION_ERROR", 401))),
      /* links-on-demand-search D1: the roster's door is the customers' now */
      handlers.customers(() =>
        ok({ results: [], nextCursor: null, matched: null, total: 0, wisphub: "ok" }),
      ),
    );
    const router = renderApp("/login?next=/links");
    await signInByCode();

    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/links");
  });

  it("a `next` that is not a same-app path is dropped (D12: no open redirect)", async () => {
    let loggedIn = false;
    server.use(
      handlers.requestCode(() => baStatus({ success: true })),
      handlers.signInCode(() => {
        loggedIn = true;
        return baSignedIn();
      }),
      handlers.getSession(() => HttpResponse.json(loggedIn ? { user: sessionUser } : null)),
      handlers.session(() => (loggedIn ? ok(businessActor) : failResponse("AUTHENTICATION_ERROR", 401))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    const router = renderApp("/login?next=https://evil.example");
    await signInByCode();

    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("US-A05 scenario 9: the phone has no header (account-hub D8)", () => {
  it("renders no <header>; the business name reads in the sidebar's switcher and the avatar carries the step", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, credit: { balanceCents: 2000, step: "low" }, observing: true })),
      handlers.feed(() => ok({ payments: [], nextCursor: null, effectiveOverTreatment: "flag", today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(document.querySelector("header")).toBeNull();
    /* Once: the sidebar's. The phone's copy of the name and both chips are gone */
    expect(screen.getAllByText("ISP Demo")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /^Saldo bajo:/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Modo observación" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Cuenta, saldo bajo" })).toHaveLength(2);
  });
});

describe("integrations-hub D10: the shell's banner names no provider and points at the catalog", () => {
  it("without an integration the banner asks to connect a system; the button goes to /integrations", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, integrationConfigured: false })),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/payments");

    expect(await screen.findByText(/conecta el sistema con el que cobras/i)).toBeInTheDocument();
    expect(screen.queryByText(/wisphub/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver integraciones/i })).toHaveAttribute("href", "/integrations");
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
