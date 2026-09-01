import { describe, expect, it } from "vitest";
import { HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsResponse } from "@devolada/api/settings-schema";
import { baOk, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
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

describe("US-B01: the wizard births the business in one call, with the bank picked from the CLABE", () => {
  it("scenario 1 (UI): name → CLABE pre-selects the bank → one POST → share a link", async () => {
    const posted: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.createBusiness((body) => {
        posted.push(body);
        return ok({ ...asRole("owner"), name: "WifiPlus Norte" }, 201);
      }),
    );
    renderApp("/nuevo-negocio");

    await userEvent.type(await screen.findByLabelText("Nombre del negocio"), "WifiPlus Norte");
    await userEvent.click(screen.getByRole("button", { name: /continuar/i }));

    /* 646 = STP: the picker is seeded from the prefix, never typed (D16) */
    await userEvent.type(await screen.findByLabelText("CLABE"), "646180157000000004");
    expect(screen.getByRole("combobox", { name: "Banco" })).toHaveTextContent("STP");

    await userEvent.type(screen.getByLabelText(/nombre del beneficiario/i), "WifiPlus SA de CV");
    await userEvent.click(screen.getByRole("button", { name: /crear negocio/i }));

    expect(await screen.findByRole("button", { name: /comparte un link de pago/i })).toBeInTheDocument();
    expect(posted).toEqual([
      {
        name: "WifiPlus Norte",
        speiClabe: "646180157000000004",
        speiBank: "STP",
        speiBeneficiaryName: "WifiPlus SA de CV",
      },
    ]);
  });

  it("the CLABE gate holds: no bank, no button", async () => {
    server.use(handlers.getSession(() => HttpResponse.json({ user: sessionUser })));
    renderApp("/nuevo-negocio");
    await userEvent.type(await screen.findByLabelText("Nombre del negocio"), "WifiPlus");
    await userEvent.click(screen.getByRole("button", { name: /continuar/i }));
    /* An unknown prefix pre-selects nothing; 18 digits alone do not unlock */
    await userEvent.type(await screen.findByLabelText("CLABE"), "999180157000000004");
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
  it("scenario 7 (UI): an operator's settings hold no business card (the passkey card is theirs, when the device has one)", async () => {
    server.use(handlers.session(() => ok(asRole("operator"))), handlers.settings(() => ok(settings())));
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Configuración" })).toBeInTheDocument();
    /* The settings answered (skeletons gone); nothing of the business rendered */
    await waitFor(() => expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0));
    expect(screen.queryByText(/conexión con wisphub/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pago directo por spei/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Usuarios" })).not.toBeInTheDocument();
  });

  it("scenario 6 (UI): an admin sees the CLABE as text — the field is the owner's — and may invite operators and viewers only", async () => {
    server.use(
      handlers.session(() => ok(asRole("admin"))),
      handlers.settings(() => ok(settings())),
      handlers.members(() => ok({ ...members, grantable: ["operator", "viewer"] })),
    );
    renderApp("/settings");
    expect(await screen.findByRole("heading", { name: /pago directo por spei/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "CLABE" })).not.toBeInTheDocument();
    expect(screen.getByText("646180157000000004")).toBeInTheDocument();

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
    renderApp("/settings");
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
      handlers.linksSearch(() =>
        ok({
          results: [
            { wisphubId: 6, usuario: "greyes@wifiplus", name: "Janely Reyes", phone: null, url: "https://pago.test/p/tok", waLink: "https://wa.me/?text=x" },
          ],
        }),
      ),
    );
    renderApp("/links");
    await userEvent.type(await screen.findByRole("searchbox"), "Jan");
    expect(await screen.findByText("Janely Reyes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compartir/i })).not.toBeInTheDocument();
  });
});

describe("D8: the invitation link", () => {
  it("an invitee with a session accepts and lands in the business", async () => {
    const accepted: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.acceptInvitation((body) => {
        accepted.push(body);
        return baOk();
      }),
      handlers.session(() => ok(asRole("viewer"))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    const router = renderApp("/invitaciones/inv-1");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
    expect(router.state.location.pathname).toBe("/payments");
  });

  it("without a session it asks to sign in first", async () => {
    server.use(handlers.getSession(() => HttpResponse.json(null)));
    renderApp("/invitaciones/inv-1");
    expect(await screen.findByRole("heading", { name: /te invitaron a un negocio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^entrar$/i })).toBeInTheDocument();
  });
});
