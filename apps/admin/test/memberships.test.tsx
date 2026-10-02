import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { baFail, baOk, baSignedIn, baStatus, baTooMany, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* docs/legacy/business/business-and-memberships.spec.md — the UI half of
   scenarios 1, 4–5, 6–9 (US-B01, US-B02, US-B03). The API half lives in
   apps/api/test/business-memberships.test.ts. */

/* passwordless-access US4: the invitation page's key door. The client is
   stood in for — the ceremony belongs to the browser layer — and starts as
   a browser without passkey support, which is what happy-dom is. */
const device = vi.hoisted(() => ({
  supported: vi.fn(() => false),
  signInPasskey: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  passkeysSupported: device.supported,
  canVerifyPerson: async () => false,
  authClient: { passkey: { addPasskey: vi.fn() }, signIn: { passkey: device.signInPasskey } },
}));
beforeEach(() => {
  device.supported.mockReset().mockReturnValue(false);
  device.signInPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
});

const settings = (over: Record<string, unknown> = {}) =>
  settingsResponse.parse({
    serviceFeeCents: 1500,
    timezone: "America/Mexico_City",
    timeFormat: "12h",
    wisphub: { configured: true, keyTail: "1234" },
    spei: {
      clabe: "646180157000000004",
      bank: "STP",
      beneficiaryName: "WifiPlus SA de CV",
      serviceFeeCents: null,
      effectiveServiceFeeCents: 1500,
      bankUnknown: false,
      configured: true,
    },
    reconnection: { thresholdPercent: 100, floorCents: 0, provisionalReleaseEnabled: false },
  reconciliationPolicy: { toleranceCents: 0, overTreatment: "flag", effectiveOverTreatment: "flag" },
    ...over,
  });

const asRole = (role: "owner" | "admin" | "operator" | "viewer") => ({
  ...businessActor,
  role,
  businesses: [{ id: "business-1", orgId: "org_business-1", name: "ISP Demo", role }],
});

const members = {
  members: [
    { id: "m-owner", userId: "user-1", name: "Leo", email: "demo@devolada.app", role: "owner", createdAt: 1 },
    { id: "m-op", userId: "user-2", name: "Ana", email: "ana@wifiplus.mx", role: "operator", createdAt: 2 },
  ],
  grantable: ["owner", "admin", "operator", "viewer"],
};

describe("US-B01: the wizard births the business with its name alone (D5, 2026-09-02)", () => {
  it("scenario 1 (UI): name → one POST → the CLABE waits in Configuración", async () => {
    const posted: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.createBusiness((body) => {
        posted.push(body);
        return ok({ ...asRole("owner"), name: "WifiPlus Norte", speiConfigured: false }, 201);
      }),
    );
    renderApp("/nuevo-negocio");

    await userEvent.type(await screen.findByLabelText("Nombre del negocio"), "WifiPlus Norte");
    await userEvent.click(screen.getByRole("button", { name: /crear negocio/i }));

    expect(await screen.findByRole("heading", { name: /tu negocio está listo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /configurar mi clabe/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("CLABE")).not.toBeInTheDocument();
    expect(posted).toEqual([{ name: "WifiPlus Norte" }]);
  });

  it("the name gate holds: under two letters, no button", async () => {
    server.use(handlers.getSession(() => HttpResponse.json({ user: sessionUser })));
    renderApp("/nuevo-negocio");
    await userEvent.type(await screen.findByLabelText("Nombre del negocio"), "W");
    expect(screen.getByRole("button", { name: /crear negocio/i })).toBeDisabled();
  });

  it("a session with no business is sent to the wizard (D4: NO_BUSINESS)", async () => {
    server.use(
      handlers.session(() => fail("NO_BUSINESS", 403)),
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
    );
    const router = renderApp("/");
    expect(await screen.findByRole("heading", { name: /crea tu negocio/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/nuevo-negocio");
  });
});

describe("US-B02: one login, several businesses", () => {
  it("scenario 4 (UI): the switcher sets the other organization active and starts over", async () => {
    const activated: unknown[] = [];
    server.use(
      handlers.session(() =>
        ok({
          ...asRole("owner"),
          businesses: [
            { id: "business-1", orgId: "org_business-1", name: "ISP Demo", role: "owner" },
            { id: "business-2", orgId: "org_business-2", name: "WifiPlus Norte", role: "admin" },
          ],
        }),
      ),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
      handlers.setActive((body) => {
        activated.push(body);
        return baOk();
      }),
    );
    renderApp("/");

    const switcher = await screen.findAllByRole("combobox", { name: "Negocio" });
    await userEvent.click(switcher[0]);
    await userEvent.click(await screen.findByRole("option", { name: "WifiPlus Norte" }));
    expect(activated).toEqual([{ organizationId: "org_business-2" }]);
  });

  it("scenario 5 (UI): several memberships and none active → the chooser lists them", async () => {
    const activated: unknown[] = [];
    server.use(
      handlers.session(() => fail("NO_ACTIVE_BUSINESS", 403)),
      handlers.orgList(() =>
        HttpResponse.json([
          { id: "org_business-1", name: "ISP Demo" },
          { id: "org_business-2", name: "WifiPlus Norte" },
        ]),
      ),
      handlers.setActive((body) => {
        activated.push(body);
        return baOk();
      }),
    );
    renderApp("/");
    expect(await screen.findByRole("heading", { name: /elige un negocio/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "WifiPlus Norte" }));
    expect(activated).toEqual([{ organizationId: "org_business-2" }]);
  });

  it("a revoked membership names the reason and offers the rest", async () => {
    server.use(
      handlers.session(() => fail("MEMBERSHIP_REVOKED", 403)),
      handlers.orgList(() => HttpResponse.json([{ id: "org_business-1", name: "ISP Demo" }])),
    );
    renderApp("/");
    expect(await screen.findByText(/ya no formas parte/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ISP Demo" })).toBeInTheDocument();
  });

  it("one business: a plain label, no switcher", async () => {
    server.use(
      handlers.session(() => ok(asRole("owner"))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/");
    expect((await screen.findAllByText("ISP Demo")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox", { name: "Negocio" })).not.toBeInTheDocument();
  });
});

describe("US-B03: roles hide, never tease", () => {
  it("scenario 7 (UI): an operator's hub holds no business row, and the business page sends them back (account-hub D5)", async () => {
    server.use(handlers.session(() => ok(asRole("operator"))), handlers.settings(() => ok(settings())));
    const router = renderApp("/settings/direct-payment");
    expect(await screen.findByRole("heading", { name: "Cuenta" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    expect(screen.queryByText(/pago directo por spei/i)).not.toBeInTheDocument();
    for (const row of [/^pago directo y conciliación/i, /^preferencias/i, /^usuarios/i, /^saldo y recargas/i, /^integraciones/i]) {
      expect(screen.queryByRole("link", { name: row })).not.toBeInTheDocument();
    }
    /* The person's own things stay: the passkeys row and the door */
    expect(screen.getByRole("link", { name: /entrar con huella o rostro/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it("scenario 6 (UI): an admin sees the CLABE as text — the field is the owner's — and may invite operators and viewers only", async () => {
    server.use(
      handlers.session(() => ok(asRole("admin"))),
      handlers.settings(() => ok(settings())),
      handlers.members(() => ok({ ...members, grantable: ["operator", "viewer"] })),
    );
    renderApp("/settings/direct-payment");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "CLABE" })).not.toBeInTheDocument();
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();
  });

  it("scenario 6 (UI): an admin may invite operators and viewers only", async () => {
    server.use(
      handlers.session(() => ok(asRole("admin"))),
      handlers.members(() => ok({ ...members, grantable: ["operator", "viewer"] })),
    );
    renderApp("/settings/users");
    const users = (await screen.findByRole("heading", { name: "Usuarios" })).closest("section")!;
    expect(within(users).getByText("Ana")).toBeInTheDocument();
    await userEvent.click(within(users).getByRole("combobox", { name: "Rol" }));
    expect(await screen.findByRole("option", { name: "Operador" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lector" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Administrador" })).not.toBeInTheDocument();
  });

  it("scenario 9 (UI): the owner invites by email with a role, and the API gets both", async () => {
    const invited: unknown[] = [];
    server.use(
      handlers.session(() => ok(asRole("owner"))),
      handlers.settings(() => ok(settings())),
      handlers.members(() => ok(members)),
      handlers.invite((body) => {
        invited.push(body);
        return ok({ id: "inv-1", email: "contador@wifiplus.mx", role: "viewer" }, 201);
      }),
    );
    renderApp("/settings/users");
    const users = (await screen.findByRole("heading", { name: "Usuarios" })).closest("section")!;
    await userEvent.type(within(users).getByLabelText(/invitar por correo/i), "contador@wifiplus.mx");
    await userEvent.click(within(users).getByRole("combobox", { name: "Rol" }));
    await userEvent.click(await screen.findByRole("option", { name: "Lector" }));
    await userEvent.click(within(users).getByRole("button", { name: /^invitar$/i }));

    expect(await screen.findByText(/invitación enviada a contador@wifiplus.mx/i)).toBeInTheDocument();
    expect(invited).toEqual([{ email: "contador@wifiplus.mx", role: "viewer" }]);
    /* The owner row cannot be removed; the operator can */
    expect(within(users).getAllByRole("button", { name: /^quitar$/i })).toHaveLength(1);
  });

  it("scenario 8 (UI): a viewer sees the customer on Links and nothing to press", async () => {
    server.use(
      handlers.session(() => ok(asRole("viewer"))),
      /* links-on-demand-search D1 (US1): the customers door, and a
         customer whose link is not born yet — the viewer must see them
         all the same, with nothing to press (FR-016) */
      handlers.customers(() =>
        ok({
          results: [
            {
              channel: "panel",
              usuario: "greyes@wifiplus",
              wisphubId: 6,
              customerRef: null,
              label: null,
              askCents: null,
              linkState: null,
              name: "Janely Reyes",
              phone: null,
              hasLink: false,
              url: null,
              waLink: null,
            },
          ],
          nextCursor: null,
          matched: null,
          total: 1,
          wisphub: "ok",
        }),
      ),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copiar/i })).not.toBeInTheDocument();
  });
});

const previewOf = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  businessName: "WifiPlus",
  role: "operator",
  email: "ana@wifiplus.mx",
  hasAccount: false,
  ...over,
});
const emptyFeed = () => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } });

describe("D8 + better-auth D14 + passwordless-access US4: the invitation page decides for the invitee", () => {
  it("signed in with the invited address: accepts, activates the business and lands inside", async () => {
    const accepted: unknown[] = [];
    const activated: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.invitationPreview(() => ok(previewOf({ email: sessionUser.email, hasAccount: true }))),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", async ({ request }) => {
        activated.push(await request.json());
        return HttpResponse.json({});
      }),
      handlers.session(() => ok(asRole("viewer"))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/invitaciones/inv-1");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
    expect(activated).toEqual([{ organizationId: "org_wifiplus" }]);
    expect(router.state.location.pathname).toBe("/payments");
  });

  it("no account for the invited address: the name alone — no password — creates, then /welcome, then inside (passwordless-access US4)", async () => {
    const born: unknown[] = [];
    let signedIn = false;
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: { ...sessionUser, email: "ana@wifiplus.mx" } } : null)),
      handlers.invitationPreview(() => ok(previewOf())),
      handlers.acceptInvitationNew((id, body) => {
        born.push([id, body]);
        signedIn = true;
        return ok(asRole("operator"), 201);
      }),
      handlers.session(() => (signedIn ? ok(asRole("operator")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/invitaciones/inv-1");

    expect(await screen.findByRole("heading", { name: /te invitaron a wifiplus/i })).toBeInTheDocument();
    expect(screen.getByText("Como operador.")).toBeInTheDocument();
    /* The address is text, never a field (design review identidad-2) */
    expect(screen.getByText("ana@wifiplus.mx")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo")).not.toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    /* FR-015: no passkey support, no word of it */
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /crear cuenta y entrar/i }));
    expect(await screen.findByText("Escribe tu nombre, al menos 2 letras.")).toBeInTheDocument();
    expect(born).toEqual([]);

    await userEvent.type(screen.getByLabelText("Tu nombre"), "Ana Torres");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta y entrar/i }));

    await screen.findByRole("heading", { name: "Pagos" });
    expect(born).toEqual([["inv-1", { name: "Ana Torres" }]]);
    expect(router.state.location.pathname).toBe("/payments");
  });

  it("the invited address has an account: a código to the invited address signs in, accepts, and lands inside (passwordless-access US4)", async () => {
    let signedIn = false;
    const accepted: unknown[] = [];
    let codeFor: unknown = null;
    let entered: unknown = null;
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: { ...sessionUser, email: "ana@wifiplus.mx" } } : null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      handlers.requestCode((body) => {
        codeFor = body;
        return baStatus({ success: true });
      }),
      handlers.signInCode((body) => {
        entered = body;
        signedIn = true;
        return baSignedIn({ ...sessionUser, email: "ana@wifiplus.mx" });
      }),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", () => HttpResponse.json({})),
      handlers.session(() => (signedIn ? ok(asRole("operator")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/invitaciones/inv-1");

    expect(await screen.findByText("Como operador.")).toBeInTheDocument();
    expect(screen.getByText("ana@wifiplus.mx")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
    expect(screen.queryByText(/contraseña/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /olvidé/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /huella o rostro/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Enviarme un código" }));
    expect(codeFor).toEqual({ email: "ana@wifiplus.mx", type: "sign-in" });
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await screen.findByRole("heading", { name: "Pagos" });
    expect(entered).toEqual({ email: "ana@wifiplus.mx", otp: "482913" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
    expect(router.state.location.pathname).toBe("/payments");
  });

  it("where passkeys are supported, the key comes first; the invited account's key accepts on sight (passwordless-access US4)", async () => {
    device.supported.mockReturnValue(true);
    let signedIn = false;
    const accepted: unknown[] = [];
    device.signInPasskey.mockImplementation(async () => {
      signedIn = true;
      return { data: {}, error: null };
    });
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: { ...sessionUser, email: "ana@wifiplus.mx" } } : null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", () => HttpResponse.json({})),
      handlers.session(() => (signedIn ? ok(asRole("operator")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    renderApp("/invitaciones/inv-1");

    const key = await screen.findByRole("button", { name: "Entrar con huella o rostro" });
    expect(screen.getByText("o con un código")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviarme un código" })).toBeInTheDocument();
    await userEvent.click(key);
    await screen.findByRole("heading", { name: "Pagos" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
  });

  it("a key of another account leads to the «otro correo» state with its switch, and accepts nothing (FR-018)", async () => {
    device.supported.mockReturnValue(true);
    let signedIn = false;
    const accepted: unknown[] = [];
    device.signInPasskey.mockImplementation(async () => {
      signedIn = true;
      return { data: {}, error: null };
    });
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: sessionUser } : null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
    );
    renderApp("/invitaciones/inv-1");

    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(await screen.findByText(/fue enviada a otro correo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar con el correo invitado/i })).toBeInTheDocument();
    expect(accepted).toEqual([]);
  });

  it("a key that fails says so and leaves the código (FR-012)", async () => {
    device.supported.mockReturnValue(true);
    device.signInPasskey.mockResolvedValue({ data: null, error: { code: "AUTH_CANCELLED" } });
    server.use(
      handlers.getSession(() => HttpResponse.json(null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
    );
    renderApp("/invitaciones/inv-1");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar con huella o rostro" }));
    expect(await screen.findByText("No pudimos usar tu huella o rostro. Entra con un código.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviarme un código" })).toBeInTheDocument();
  });

  it("a 429 on «Enviarme un código» or on «Entrar» says to wait (FR-027)", async () => {
    let asked = 0;
    server.use(
      handlers.getSession(() => HttpResponse.json(null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      handlers.requestCode(() => (++asked === 1 ? baTooMany() : baStatus({ success: true }))),
      handlers.signInCode(() => baTooMany()),
    );
    renderApp("/invitaciones/inv-1");
    await userEvent.click(await screen.findByRole("button", { name: "Enviarme un código" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Enviarme un código" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Demasiados intentos. Espera un momento e intenta de nuevo.")).toBeInTheDocument();
  });

  it("signed in with another email: the screen says so and offers to switch", async () => {
    let loggedOut = false;
    server.use(
      handlers.getSession(() => HttpResponse.json(loggedOut ? null : { user: sessionUser })),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      handlers.logout(() => {
        loggedOut = true;
        return baOk();
      }),
    );
    const router = renderApp("/invitaciones/inv-1");

    expect(await screen.findByText(/fue enviada a otro correo/i)).toBeInTheDocument();
    expect(screen.getByText(/entraste como demo@devolada\.app/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /entrar con el correo invitado/i }));

    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(loggedOut).toBe(true);
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/invitaciones/inv-1" });
  });

  it("expired and gone invitations are named for what they are", async () => {
    server.use(
      handlers.getSession(() => HttpResponse.json(null)),
      handlers.invitationPreview((id) => ok(id === "old" ? previewOf({ status: "expired" }) : previewOf({ status: "gone", businessName: null, role: null, email: null }))),
    );
    renderApp("/invitaciones/old");
    expect(await screen.findByText(/esta invitación venció/i)).toBeInTheDocument();
    /* Every dead end has a door (design review identidad-2) */
    expect(screen.getByRole("link", { name: /ir a iniciar sesión/i })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/48 horas/i)).toBeInTheDocument();

    renderApp("/invitaciones/nope");
    expect(await screen.findByRole("heading", { name: /ya no existe/i })).toBeInTheDocument();
  });
});
