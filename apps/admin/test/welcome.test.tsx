import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { baStatus, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* passwordless-access US1 (contracts/panel-access.md § /welcome; D6, D7):
   where a código lands. It asks a missing name first, then offers the key
   where the device can verify the person, then goes on to `next`. The
   ceremony runs in the click; what the browser answers is read the way the
   real client reports it (features/auth/keys.ts). */

const device = vi.hoisted(() => ({
  canVerifyPerson: vi.fn(async () => true),
  addPasskey: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  canVerifyPerson: device.canVerifyPerson,
  passkeysSupported: () => true,
  authClient: { passkey: { addPasskey: device.addPasskey }, signIn: { passkey: vi.fn() } },
}));
beforeEach(() => {
  device.canVerifyPerson.mockReset().mockResolvedValue(true);
  device.addPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
});

const feed = () => handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } }));
const named = () => handlers.getSession(() => HttpResponse.json({ user: sessionUser }));
const OFFER = "Entra la próxima vez con tu huella o rostro";

describe("passwordless-access US1 — /welcome asks a missing name first (D1, D6)", () => {
  it("«¿Cómo te llamas?» saves the name, then offers the key", async () => {
    let saved: unknown = null;
    let name = "";
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name } })),
      handlers.updateUser((body) => {
        saved = body;
        name = String(body.name);
        return baStatus({ status: true });
      }),
    );
    renderApp("/welcome?next=/payments");

    expect(await screen.findByRole("heading", { name: "¿Cómo te llamas?" })).toBeInTheDocument();
    await expectNoViolations(document.body);
    /* the name's rule, before the request */
    await userEvent.type(screen.getByLabelText("Tu nombre"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Escribe tu nombre, al menos 2 letras.")).toBeInTheDocument();
    expect(saved).toBeNull();

    await userEvent.type(screen.getByLabelText("Tu nombre"), "na López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
    expect(saved).toEqual({ name: "Ana López" });
  });
});

describe("passwordless-access US1 — /welcome offers the key only where the device can verify the person (D7)", () => {
  it("a device that cannot goes straight to `next`, the offer never painted", async () => {
    device.canVerifyPerson.mockResolvedValue(false);
    server.use(named(), handlers.session(() => ok(businessActor)), feed());
    const router = renderApp("/welcome?next=/payments");

    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
    expect(device.addPasskey).not.toHaveBeenCalled();
  });

  it("the offer says FR-008's four things, and «Ahora no» goes on with no key", async () => {
    server.use(named(), handlers.session(() => ok(businessActor)), feed());
    const router = renderApp("/welcome?next=/payments");

    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
    for (const line of [
      "La próxima vez entras con tu huella o tu rostro, sin escribir nada.",
      "Devolada nunca ve tu huella ni tu rostro: se quedan en tu dispositivo.",
      "Si tu llavero de iCloud o de Google sincroniza tus llaves, también servirá en tus otros dispositivos.",
      "Si otras personas desbloquean este dispositivo, también podrán entrar. En un equipo compartido, elige «Ahora no».",
    ]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
    expect(device.addPasskey).not.toHaveBeenCalled();
  });

  it("the ceremony runs in the click; «Listo.» for a beat, then `next`", async () => {
    server.use(named(), handlers.session(() => ok(businessActor)), feed());
    const router = renderApp("/welcome?next=/payments");

    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(device.addPasskey).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Listo.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/payments"), { timeout: 4000 });
  });

  it("a cancelled window (NotAllowedError) is one line, with both ways on still there (FR-009)", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "NotAllowedError" } });
    server.use(named());
    const router = renderApp("/welcome?next=/payments");

    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(await screen.findByText("No se pudo activar. Intenta de nuevo o elige «Ahora no».")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activar huella o rostro" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeEnabled();
    expect(router.state.location.pathname).toBe("/welcome");
  });

  it("a device that already holds a key (InvalidStateError) counts as done, and goes on", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" } });
    server.use(named(), handlers.session(() => ok(businessActor)), feed());
    const router = renderApp("/welcome?next=/payments");

    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(await screen.findByText("Este dispositivo ya tiene tu huella o rostro.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/payments"), { timeout: 4000 });
  });

  it("a thrown InvalidStateError reads the same as the client's answer", async () => {
    device.addPasskey.mockRejectedValue(new DOMException("already", "InvalidStateError"));
    server.use(named());
    renderApp("/welcome?next=/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(await screen.findByText("Este dispositivo ya tiene tu huella o rostro.")).toBeInTheDocument();
  });
});

describe("passwordless-access US1 — /welcome needs a session, and `next` stays in the app (better-auth D12)", () => {
  it("no session goes to /login, keeping `next`", async () => {
    server.use(handlers.getSession(() => HttpResponse.json(null)));
    const router = renderApp("/welcome?next=/links");
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/links" });
  });

  it("an absolute `next` is dropped: the way on is the panel", async () => {
    device.canVerifyPerson.mockResolvedValue(false);
    server.use(named(), handlers.session(() => ok(businessActor)), feed());
    const router = renderApp("/welcome?next=https://evil.example");
    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("passwordless-access US1 — the nameless guard sends a session with no name to /welcome, once (D6)", () => {
  it("from the shell, keeping the path", async () => {
    server.use(
      handlers.session(() => ok({ ...businessActor, userName: "" })),
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: "" } })),
      feed(),
    );
    const router = renderApp("/links");
    expect(await screen.findByRole("heading", { name: "¿Cómo te llamas?" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    expect(router.state.location.search).toEqual({ next: "/links" });
  });

  it("from the business wizard, where a person born at the sign-in door lands", async () => {
    server.use(
      handlers.session(() => fail("NO_BUSINESS", 403)),
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: "" } })),
    );
    const router = renderApp("/nuevo-negocio");
    expect(await screen.findByRole("heading", { name: "¿Cómo te llamas?" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ next: "/nuevo-negocio" });
  });
});
