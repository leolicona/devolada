import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
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
/* /welcome reads the actor the way the shell does (adversarial review, 2026-10-02) */
const member = () => handlers.session(() => ok(businessActor));
const OFFER = "Entra la próxima vez con tu huella o rostro";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("passwordless-access US1 — /welcome asks a missing name first (D1, D6)", () => {
  it("«¿Cómo te llamas?» saves the name, then offers the key", async () => {
    let saved: unknown = null;
    let name = "";
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name } })),
      handlers.session(() => fail("NO_BUSINESS", 403)),
      handlers.updateUser((body) => {
        saved = body;
        name = String(body.name);
        return baStatus({ status: true });
      }),
    );
    renderApp("/welcome?next=/payments");

    expect(await screen.findByRole("heading", { name: "¿Cómo te llamas?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tu nombre")).toHaveAttribute("maxLength", "80");
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

  it("a name over 80 letters is named under the field, before any request (adversarial review, 2026-10-02)", async () => {
    let saved: unknown = null;
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: "" } })),
      handlers.session(() => fail("NO_BUSINESS", 403)),
      handlers.updateUser((body) => {
        saved = body;
        return baStatus({ status: true });
      }),
    );
    renderApp("/welcome?next=/payments");
    /* the field stops at 80; a value set past it (autofill) still meets the rule */
    fireEvent.change(await screen.findByLabelText("Tu nombre"), { target: { value: "A".repeat(81) } });
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Escribe tu nombre en 80 letras o menos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu nombre")).toHaveAttribute("aria-invalid", "true");
    expect(saved).toBeNull();
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
    const activate = await screen.findByRole("button", { name: "Activar huella o rostro" });

    /* Safari refuses a WebAuthn call outside a user gesture (D7). WHEN the
       client is called is what is asserted: while the click is still
       travelling through the document, between the window's capture
       listener and its bubble listener — as packages/ui's passkey-offer
       test does for the atom. A ceremony started after an await would
       record false (adversarial review, 2026-10-02). */
    let dispatching = false;
    const begin = () => void (dispatching = true);
    const end = () => void (dispatching = false);
    const calls: boolean[] = [];
    device.addPasskey.mockImplementation(async () => {
      calls.push(dispatching);
      return { data: {}, error: null };
    });
    window.addEventListener("click", begin, true);
    window.addEventListener("click", end);
    try {
      fireEvent.click(activate);
    } finally {
      window.removeEventListener("click", begin, true);
      window.removeEventListener("click", end);
    }
    expect(calls).toEqual([true]);

    expect(await screen.findByText("Listo.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/payments"), { timeout: 4000 });
  });

  it("a cancelled window (NotAllowedError) is one line, with both ways on still there (FR-009)", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "NotAllowedError" } });
    server.use(named(), member());
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
    server.use(named(), member());
    renderApp("/welcome?next=/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(await screen.findByText("Este dispositivo ya tiene tu huella o rostro.")).toBeInTheDocument();
  });
});

describe("passwordless-access US1 — /welcome needs a session, and `next` stays in the app (better-auth D12)", () => {
  it("no session goes to /login, keeping `next`", async () => {
    server.use(handlers.getSession(() => HttpResponse.json(null)), handlers.session(() => fail("AUTHENTICATION_ERROR", 401)));
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

describe("passwordless-access US1 — a name saved on /welcome is the name the guards read next (D6; adversarial review, 2026-10-02)", () => {
  /* Every place the router went after the first, in order: the guard's
     bounce to /welcome, then the way on — and nothing after it */
  const visits = (router: ReturnType<typeof renderApp>) => {
    const seen: string[] = [];
    router.history.subscribe(({ location }) => seen.push(location.pathname));
    return seen;
  };
  const nameless = () => {
    const person = { name: "" };
    return {
      person,
      handlers: [
        handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: person.name } })),
        handlers.session(() => ok({ ...businessActor, userName: person.name })),
        handlers.updateUser((body) => {
          person.name = String(body.name);
          return baStatus({ status: true });
        }),
      ],
    };
  };
  const links = () => handlers.customers(() => ok({ results: [], nextCursor: null, matched: null, total: 0, wisphub: "ok" }));

  it("from the shell, on a device that cannot verify the person: named once, then `next`, never back", async () => {
    device.canVerifyPerson.mockResolvedValue(false);
    const { handlers: api } = nameless();
    server.use(...api, links());
    const router = renderApp("/links");
    const seen = visits(router);

    await userEvent.type(await screen.findByLabelText("Tu nombre"), "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    /* the shell answered its own refetch too: still here, never asked again */
    await waitFor(() => expect(seen).toEqual(["/welcome", "/links"]));
    expect(screen.queryByRole("heading", { name: "¿Cómo te llamas?" })).not.toBeInTheDocument();
  });

  it("from the shell, offered and refused: «Ahora no» lands on `next`, and the offer is not shown again", async () => {
    const { handlers: api } = nameless();
    server.use(...api, links());
    const router = renderApp("/links");
    const seen = visits(router);

    await userEvent.type(await screen.findByLabelText("Tu nombre"), "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(await screen.findByRole("heading", { name: "Links de pago" })).toBeInTheDocument();
    await waitFor(() => expect(seen).toEqual(["/welcome", "/links"]));
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
  });

  it("from the business wizard: named once, then the wizard, never back", async () => {
    device.canVerifyPerson.mockResolvedValue(false);
    const { person, handlers: api } = nameless();
    server.use(...api, handlers.session(() => fail("NO_BUSINESS", 403)));
    const router = renderApp("/nuevo-negocio");
    const seen = visits(router);

    await userEvent.type(await screen.findByLabelText("Tu nombre"), "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
    await waitFor(() => expect(seen).toEqual(["/welcome", "/nuevo-negocio"]));
    expect(person.name).toBe("Ana López");
  });
});

describe("passwordless-access US1 — /welcome offers a key only to a session that can still add one (D8; adversarial review, 2026-10-02)", () => {
  const bornAgo = (ms: number) => ({ createdAt: new Date(Date.now() - ms).toISOString() });

  it("a session a day old — a tab closed at the name, come back later — is named and goes on, unoffered", async () => {
    let name = "";
    server.use(
      handlers.getSession(() => HttpResponse.json({ session: bornAgo(DAY_MS + 60 * 60 * 1000), user: { ...sessionUser, name } })),
      handlers.session(() => fail("NO_BUSINESS", 403)),
      handlers.updateUser((body) => {
        name = String(body.name);
        return baStatus({ status: true });
      }),
    );
    const router = renderApp("/welcome?next=/nuevo-negocio");
    await userEvent.type(await screen.findByLabelText("Tu nombre"), "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/nuevo-negocio");
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
    expect(device.addPasskey).not.toHaveBeenCalled();
  });

  it("a session born minutes ago is offered", async () => {
    server.use(handlers.getSession(() => HttpResponse.json({ session: bornAgo(5 * 60 * 1000), user: sessionUser })), member());
    renderApp("/welcome?next=/payments");
    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
  });

  it("a session that turned a day old while the offer was open goes on to `next`, not to a retry that cannot work", async () => {
    device.addPasskey.mockResolvedValue({ data: null, error: { code: "SESSION_NOT_FRESH", status: 403 } });
    server.use(named(), member(), feed());
    const router = renderApp("/welcome?next=/payments");
    await userEvent.click(await screen.findByRole("button", { name: "Activar huella o rostro" }));
    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.queryByText("No se pudo activar. Intenta de nuevo o elige «Ahora no».")).not.toBeInTheDocument();
  });
});

describe("passwordless-access US1 — /welcome answers the account the shell refuses with its own screen, unoffered (adversarial review, 2026-10-02)", () => {
  it("a store's account goes on to «Esta cuenta es de una tienda.»: no offer, no key", async () => {
    server.use(named(), handlers.session(() => ok({ type: "store" })));
    const router = renderApp("/welcome?next=/payments");
    expect(await screen.findByRole("heading", { name: "Esta cuenta es de una tienda." })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
    expect(device.canVerifyPerson).not.toHaveBeenCalled();
    expect(device.addPasskey).not.toHaveBeenCalled();
  });

  /* As the server answers it: the session dies in the same response that
     says ACCOUNT_SUSPENDED (the API's businessActorOf), so every read after
     the first hears only "no session". /welcome is the one that hears the
     suspension, and it must say it there — going on let the shell's read
     answer 401 and loop the person back to /login. */
  const suspendedOnce = () => {
    let alive = true;
    const reads = { me: 0 };
    return {
      reads,
      handlers: [
        handlers.getSession(() => HttpResponse.json(alive ? { user: { ...sessionUser, name: "" } } : null)),
        handlers.session(() => {
          reads.me += 1;
          if (!alive) return fail("AUTHENTICATION_ERROR", 401);
          alive = false;
          return fail("ACCOUNT_SUSPENDED", 403);
        }),
        handlers.support(() => ok({ whatsapp: null, email: null })),
      ],
    };
  };

  it("a suspended business is told «Cuenta suspendida» on /welcome, nameless or not: nothing asked, nothing offered, never /login", async () => {
    const { reads, handlers: api } = suspendedOnce();
    server.use(...api);
    const router = renderApp("/welcome?next=/payments");
    const seen: string[] = [];
    router.history.subscribe(({ location }) => seen.push(location.pathname));

    expect(await screen.findByRole("heading", { name: "Cuenta suspendida" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    /* the tab comes back into focus: both reads run again and now answer
       "no session" — the screen stays, said once and for good */
    try {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await waitFor(() => expect(reads.me).toBe(2));
    } finally {
      focusManager.setFocused(undefined);
    }
    expect(screen.getByRole("heading", { name: "Cuenta suspendida" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    expect(seen).not.toContain("/login");
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "¿Cómo te llamas?" })).not.toBeInTheDocument();
    expect(device.addPasskey).not.toHaveBeenCalled();
    await expectNoViolations(document.body);
  });

  it.each(["NO_BUSINESS", "NO_ACTIVE_BUSINESS", "MEMBERSHIP_REVOKED"])("a session the panel still serves (%s) is offered", async (code) => {
    server.use(named(), handlers.session(() => fail(code, 403)));
    renderApp("/welcome?next=/payments");
    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
  });
});

describe("passwordless-access US1 — /welcome tells a failed read from no session (adversarial review, 2026-10-02)", () => {
  it("a session read that fails says so with «Reintentar», never /login; the retry decides", async () => {
    let down = true;
    server.use(
      handlers.getSession(() => (down ? HttpResponse.json({ message: "unavailable" }, { status: 503 }) : HttpResponse.json({ user: sessionUser }))),
      member(),
    );
    const router = renderApp("/welcome?next=/payments");

    expect(await screen.findByText("No pudimos cargar tu sesión.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    await expectNoViolations(document.body);

    down = false;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
  });

  it("a refusal the server answered (a suspended store's, its session already gone) is no retry: it goes on, and the way on ends at «Iniciar sesión»", async () => {
    let alive = true;
    server.use(
      handlers.getSession(() => HttpResponse.json(alive ? { user: sessionUser } : null)),
      handlers.session(() => {
        if (!alive) return fail("AUTHENTICATION_ERROR", 401);
        alive = false;
        return fail("STORE_SUSPENDED", 403);
      }),
    );
    const router = renderApp("/welcome?next=/payments");

    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.queryByText("No pudimos cargar tu sesión.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
    expect(device.canVerifyPerson).not.toHaveBeenCalled();
  });

  it("an actor read that fails is a retry too: the offer waits for an answer", async () => {
    let down = true;
    server.use(named(), handlers.session(() => (down ? fail("INTERNAL_ERROR", 500) : ok(businessActor))));
    renderApp("/welcome?next=/payments");

    expect(await screen.findByText("No pudimos cargar tu sesión.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: OFFER })).not.toBeInTheDocument();
    down = false;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: OFFER })).toBeInTheDocument();
  });
});
