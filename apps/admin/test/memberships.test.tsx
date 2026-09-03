import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { baFail, baOk, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* docs/business/business-and-memberships.spec.md — the UI half of
   scenarios 1, 4–5, 6–9 (US-B01, US-B02, US-B03). The API half lives in
   apps/api/test/business-memberships.test.ts. */

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
      handlers.linksRoster(() =>
        ok({
          results: [
            { wisphubId: 6, usuario: "greyes@wifiplus", name: "Janely Reyes", phone: null, url: "https://pago.test/p/tok", waLink: "https://wa.me/?text=x" },
          ],
          complete: true,
          readAt: Date.now(),
        }),
      ),
    );
    renderApp("/links");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /whatsapp/i })).not.toBeInTheDocument();
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

describe("D8 + better-auth D14: the invitation page decides for the invitee", () => {
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

  it("no account for the invited address: one form — fixed email, name, new password — creates and enters", async () => {
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
    expect(screen.getByText(/como operador\. crea tu contraseña/i)).toBeInTheDocument();
    /* The address is text, never a field (design review identidad-2) */
    expect(screen.getByText("ana@wifiplus.mx")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^entrar$/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Tu nombre"), "Ana Torres");
    await userEvent.type(screen.getByLabelText(/crea tu contraseña/i), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /crear cuenta y entrar/i }));

    await screen.findByRole("heading", { name: "Pagos" });
    expect(born).toEqual([["inv-1", { name: "Ana Torres", password: "devolada123" }]]);
    expect(router.state.location.pathname).toBe("/payments");
  });

  it("the invited address has an account: the password alone signs in and accepts", async () => {
    let signedIn = false;
    const accepted: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: { ...sessionUser, email: "ana@wifiplus.mx" } } : null)),
      handlers.invitationPreview(() => ok(previewOf({ hasAccount: true }))),
      handlers.login(() => {
        signedIn = true;
        return baOk();
      }),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", () => HttpResponse.json({})),
      handlers.session(() => (signedIn ? ok(asRole("operator")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    renderApp("/invitaciones/inv-1");

    expect(await screen.findByText(/como operador\. entra con tu contraseña/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

    await screen.findByRole("heading", { name: "Pagos" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
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
