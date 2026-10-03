import { afterEach, describe, expect, it } from "vitest";
import { HttpResponse } from "msw";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { baStatus, baSignedIn, businessActor, fail, handlers, ok, server, sessionUser } from "./msw";
import { renderApp } from "./render";

/* passwordless-access US3 (FR-015, FR-016; D7): a device without passkey
   support is complete with the código alone — no offer, no button, no
   mention of the fingerprint or face. A computer whose browser knows
   passkeys but cannot verify the person itself shows the sign-in button (a
   phone nearby can answer it) and never opens the activation by itself.
   The real `lib/auth-client` runs here: happy-dom has no
   PublicKeyCredential, which is the device without support. */

type PkcWindow = { PublicKeyCredential?: unknown };
afterEach(() => {
  delete (window as PkcWindow).PublicKeyCredential;
});

const newcomer = () => [
  handlers.requestCode(() => baStatus({ success: true })),
  handlers.signInCode(() => baSignedIn({ ...sessionUser, name: "Ana López" })),
  handlers.getSession(() => HttpResponse.json({ user: { ...sessionUser, name: "Ana López" } })),
  handlers.session(() => fail("NO_BUSINESS", 403)),
];

describe("passwordless-access US3 — without passkey support the código is the whole door", () => {
  it("registration goes from the código straight to the wizard: no offer, no word of fingerprint or face", async () => {
    expect((window as PkcWindow).PublicKeyCredential).toBeUndefined();
    server.use(...newcomer());
    renderApp("/signup");
    /* asked of step 1 once it rendered: before the router's first load the
       document is empty, and the check could not fail (adversarial review,
       2026-10-02) */
    const name = await screen.findByLabelText("Tu nombre");
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();

    await userEvent.type(name, "Ana López");
    await userEvent.type(screen.getByLabelText("Correo"), "ana@negocio.mx");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
  });

  it("/login has no key button and says nothing of fingerprint or face", async () => {
    renderApp("/login");
    await screen.findByLabelText("Correo");
    expect(screen.queryByRole("button", { name: /huella o rostro/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
    /* «Enviar código» is the primary action now */
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });
});

describe("passwordless-access US3 — passkeys known, but the device cannot verify the person (FR-016)", () => {
  it("/login shows the key button; /welcome skips the offer and goes on", async () => {
    (window as PkcWindow).PublicKeyCredential = class {
      static isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
    };
    renderApp("/login");
    expect(await screen.findByRole("button", { name: "Entrar con huella o rostro" })).toBeInTheDocument();
  });

  it("/welcome after a código: no offer, straight to the wizard", async () => {
    (window as PkcWindow).PublicKeyCredential = class {
      static isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
    };
    server.use(...newcomer());
    const router = renderApp("/welcome?next=/nuevo-negocio");
    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/nuevo-negocio");
    expect(screen.queryByRole("heading", { name: "Entra la próxima vez con tu huella o rostro" })).not.toBeInTheDocument();
  });

  it("a platform check that throws is a no, never an error on screen", async () => {
    (window as PkcWindow).PublicKeyCredential = class {
      static isUserVerifyingPlatformAuthenticatorAvailable = async () => {
        throw new Error("not allowed here");
      };
    };
    server.use(...newcomer());
    renderApp("/welcome?next=/nuevo-negocio");
    expect(await screen.findByRole("heading", { name: "Crea tu negocio" })).toBeInTheDocument();
  });
});

/* passwordless-access US4 scenario 5 (FR-015, FR-019; D9 as amended
   2026-10-03): the invitation page on a device without passkey support —
   the código with an account, the name and the código without one — and
   never a word of the fingerprint or face. */
describe("passwordless-access US4 — the invitation without passkey support", () => {
  const preview = (hasAccount: boolean) =>
    handlers.invitationPreview(() =>
      ok({ status: "pending", businessName: "WifiPlus", role: "operator", email: "ana@wifiplus.mx", hasAccount }),
    );

  it("without an account: the name, then the código, then inside — no offer, no word of fingerprint or face", async () => {
    expect((window as PkcWindow).PublicKeyCredential).toBeUndefined();
    let born = false;
    server.use(
      preview(false),
      handlers.requestCode(() => baStatus({ success: true })),
      handlers.acceptInvitationNew(() => {
        born = true;
        return ok(businessActor, 201);
      }),
      handlers.getSession(() => HttpResponse.json(born ? { user: { ...sessionUser, name: "Ana López", email: "ana@wifiplus.mx" } } : null)),
      handlers.session(() => (born ? ok(businessActor) : fail("AUTHENTICATION_ERROR", 401))),
      handlers.feed(() => ok({ payments: [], nextCursor: null, today: { count: 0, totalCents: 0, startedAtMs: 0 } })),
    );
    renderApp("/invitaciones/inv-1");
    const name = await screen.findByLabelText("Tu nombre");
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();

    await userEvent.type(name, "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.type(await screen.findByLabelText("Código"), "482913");
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(born).toBe(true);
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
  });

  it("with an account: the código is the door, and the key is never mentioned", async () => {
    server.use(preview(true), handlers.getSession(() => HttpResponse.json(null)));
    renderApp("/invitaciones/inv-1");
    expect(await screen.findByRole("button", { name: "Enviarme un código" })).toBeInTheDocument();
    expect(screen.queryByText(/huella|rostro/i)).not.toBeInTheDocument();
    expect(screen.queryByText("o con un código")).not.toBeInTheDocument();
  });
});
