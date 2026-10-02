import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { myInvitationsResponse } from "@devolada/api/businesses-schema";
import { baOk, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* bug: invitee-lands-own-business — an invitee who already had a
   business never joined: the recovery door forgot the invitation and
   landed them in their own business, and nothing in the panel ever named
   the invitation again. The API half lives in
   apps/api/test/invitee-lands-own-business.test.ts. */

const ANA = { ...sessionUser, email: "ana@wifiplus.mx" };

const asRole = (role: "owner" | "admin" | "operator" | "viewer", name = "ISP Demo") => ({
  ...businessActor,
  role,
  name,
  businesses: [{ id: "business-1", orgId: "org_business-1", name, role }],
});

const previewOf = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  businessName: "WifiPlus Norte",
  role: "operator",
  email: "ana@wifiplus.mx",
  hasAccount: true,
  ...over,
});

/* Parsed against the contract, so the fixture cannot drift from it */
const invitations = (list: { id: string; businessName: string; role: string }[]) =>
  myInvitationsResponse.parse({
    invitations: list.map((i) => ({ ...i, expiresAt: Date.now() + 47 * 3600 * 1000 })),
  });

const emptyFeed = () => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } });

describe("bug: invitee-lands-own-business — recovery comes back to the invitation", () => {
  it("from the invitation page, a forgotten password returns to it, which accepts and lands inside the inviting business", async () => {
    let signedIn = false;
    const accepted: unknown[] = [];
    const activated: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: ANA } : null)),
      handlers.invitationPreview(() => ok(previewOf())),
      handlers.requestReset(() => baOk()),
      handlers.resetPassword(() => baOk()),
      handlers.login(() => {
        signedIn = true;
        return baOk();
      }),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", async ({ request }) => {
        activated.push(await request.json());
        return HttpResponse.json({});
      }),
      handlers.session(() => (signedIn ? ok(asRole("operator", "WifiPlus Norte")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/invitaciones/inv-1");

    expect(await screen.findByText(/como operador\. entra con tu contraseña/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /olvidé mi contraseña/i }));

    /* The invitation rides along, and its address is already there (D14) */
    expect(await screen.findByRole("heading", { name: /recuperar contraseña/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/recover");
    expect(router.state.location.search).toEqual({ next: "/invitaciones/inv-1", email: "ana@wifiplus.mx" });
    expect(screen.getByLabelText("Correo")).toHaveValue("ana@wifiplus.mx");
    expect(screen.getByRole("link", { name: /volver a iniciar sesión/i })).toHaveAttribute(
      "href",
      expect.stringContaining("next=%2Finvitaciones%2Finv-1"),
    );

    await userEvent.click(screen.getByRole("button", { name: /enviar código/i }));
    await userEvent.type(await screen.findByLabelText("Código"), "123456");
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "devolada123");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    /* Back on the invitation, signed in with the invited address: it
       accepts and activates the business that invited — not "/" of the
       person's own business */
    await screen.findByRole("heading", { name: "Pagos" });
    expect(accepted).toEqual([{ invitationId: "inv-1" }]);
    expect(activated).toEqual([{ organizationId: "org_wifiplus" }]);
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.getAllByText("WifiPlus Norte").length).toBeGreaterThan(0);
  });

  it("the login page's recovery keeps where the person was going", async () => {
    server.use(handlers.getSession(() => HttpResponse.json(null)));
    const router = renderApp("/login?next=%2Finvitaciones%2Finv-1");

    await userEvent.click(await screen.findByRole("link", { name: /olvidé mi contraseña/i }));
    expect(await screen.findByRole("heading", { name: /recuperar contraseña/i })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ next: "/invitaciones/inv-1" });
  });

  it("a plain recovery, with nowhere to go back to, still lands on the panel", async () => {
    let signedIn = false;
    server.use(
      handlers.getSession(() => HttpResponse.json(signedIn ? { user: sessionUser } : null)),
      handlers.requestReset(() => baOk()),
      handlers.resetPassword(() => baOk()),
      handlers.login(() => {
        signedIn = true;
        return baOk();
      }),
      handlers.session(() => (signedIn ? ok(asRole("owner")) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/recover");

    await userEvent.type(await screen.findByLabelText("Correo"), "demo@devolada.app");
    await userEvent.click(screen.getByRole("button", { name: /enviar código/i }));
    await userEvent.type(await screen.findByLabelText("Código"), "123456");
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "devolada123");
    await userEvent.type(screen.getByLabelText("Repite la contraseña"), "devolada123");
    await userEvent.click(screen.getByRole("button", { name: /guardar contraseña/i }));

    await screen.findByRole("heading", { name: "Pagos" });
    expect(router.state.location.pathname).toBe("/payments");
  });
});

describe("bug: invitee-lands-own-business — the panel names the invitation", () => {
  it("signed in to their own business, the invitee sees it in the shell; Unirme opens the invitation, which accepts", async () => {
    let joined = false;
    const accepted: unknown[] = [];
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.myInvitations(() =>
        ok(joined ? invitations([]) : invitations([{ id: "inv-1", businessName: "WifiPlus Norte", role: "operator" }])),
      ),
      handlers.invitationPreview(() => ok(previewOf({ email: sessionUser.email }))),
      http.post("/auth/organization/accept-invitation", async ({ request }) => {
        accepted.push(await request.json());
        joined = true;
        return HttpResponse.json({ invitation: { organizationId: "org_wifiplus" } });
      }),
      http.post("/auth/organization/set-active", () => HttpResponse.json({})),
      handlers.session(() => ok(joined ? asRole("operator", "WifiPlus Norte") : asRole("owner"))),
      handlers.feed(emptyFeed),
    );
    const router = renderApp("/payments");

    /* Their own business, and the invitation named inside it */
    expect(await screen.findByText(/te invitaron a/i)).toHaveTextContent("Te invitaron a WifiPlus Norte como operador.");
    expect(screen.getAllByText("ISP Demo").length).toBeGreaterThan(0);
    await expectNoViolations(document.body);

    await userEvent.click(screen.getByRole("button", { name: "Unirme a WifiPlus Norte" }));

    await waitFor(() => expect(accepted).toEqual([{ invitationId: "inv-1" }]));
    await screen.findByRole("heading", { name: "Pagos" });
    expect(router.state.location.pathname).toBe("/payments");
    expect(screen.getAllByText("WifiPlus Norte").length).toBeGreaterThan(0);
    /* Spent: nothing left to offer */
    await waitFor(() => expect(screen.queryByText(/te invitaron a/i)).not.toBeInTheDocument());
  });

  it("someone invited who signed up on their own is offered the invitation before a business of their own", async () => {
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: ANA })),
      handlers.myInvitations(() => ok(invitations([{ id: "inv-1", businessName: "WifiPlus Norte", role: "admin" }]))),
    );
    renderApp("/nuevo-negocio");

    expect(await screen.findByText(/te invitaron a/i)).toHaveTextContent("Te invitaron a WifiPlus Norte como administrador.");
    expect(screen.getByRole("button", { name: "Unirme a WifiPlus Norte" }).closest("a")).toHaveAttribute(
      "href",
      "/invitaciones/inv-1",
    );
    /* The wizard stays: joining is an offer, not a wall */
    expect(screen.getByLabelText("Nombre del negocio")).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("someone with several businesses sees it on the chooser, where they land after signing in", async () => {
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.session(() => fail("NO_ACTIVE_BUSINESS", 403)),
      handlers.orgList(() =>
        HttpResponse.json([
          { id: "org_business-1", name: "ISP Demo" },
          { id: "org_business-2", name: "Fibra Sur" },
        ]),
      ),
      handlers.myInvitations(() => ok(invitations([{ id: "inv-1", businessName: "WifiPlus Norte", role: "viewer" }]))),
    );
    renderApp("/payments");

    expect(await screen.findByRole("heading", { name: /elige un negocio/i })).toBeInTheDocument();
    expect(await screen.findByText(/te invitaron a/i)).toHaveTextContent("Te invitaron a WifiPlus Norte como lector.");
    expect(screen.getByRole("button", { name: "Unirme a WifiPlus Norte" }).closest("a")).toHaveAttribute(
      "href",
      "/invitaciones/inv-1",
    );
    expect(await screen.findByRole("button", { name: "Fibra Sur" })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("nothing to offer, or a read that fails, says nothing", async () => {
    server.use(
      handlers.getSession(() => HttpResponse.json({ user: sessionUser })),
      handlers.myInvitations(() => fail("AUTHENTICATION_ERROR", 401)),
      handlers.session(() => ok(asRole("owner"))),
      handlers.feed(emptyFeed),
    );
    renderApp("/payments");
    await screen.findByRole("heading", { name: "Pagos" });
    expect(screen.queryByText(/te invitaron a/i)).not.toBeInTheDocument();
  });
});
