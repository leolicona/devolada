import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { apiIntegrationResponse, issueCredentialResponse } from "@devolada/api/integrations-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* automated-collections-api US1 (FR-001, FR-003, FR-004, FR-009): the
   panel's API card. The key shows once and never again, the tail names
   it afterwards, revoking takes effect, every wait sits in <Pending>,
   and the platform's own condition is worded as Devolada's. */

const at = Date.UTC(2026, 8, 17, 18, 30);

const credential = (over: Record<string, unknown> = {}) => ({
  id: "cred-1",
  name: "Sistema de facturación",
  keyTail: "9f3a",
  isTest: false,
  lastUsedAt: at,
  revokedAt: null,
  createdAt: at - 86_400_000,
  ...over,
});

const integration = (over: Record<string, unknown> = {}) =>
  apiIntegrationResponse.parse({ credentials: [credential()], validationAvailable: true, ...over });

const arrange = (r: () => ReturnType<typeof ok> = () => ok(integration())) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.apiIntegration(r));
  renderApp("/integrations/api");
};

describe("FR-003: the credential is recognised by its tail and never shown again", () => {
  it("lists the credential with its tail, its status as icon + text, and passes axe", async () => {
    arrange();
    expect(await screen.findByText("Sistema de facturación")).toBeInTheDocument();
    expect(screen.getByText("••••9f3a")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.queryByText(/^dk_/)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a revoked credential stays listed, marked, with no Revocar", async () => {
    arrange(() => ok(integration({ credentials: [credential({ revokedAt: at })] })));
    expect(await screen.findByText("Revocada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revocar" })).not.toBeInTheDocument();
  });
});

describe("FR-001: issuing a credential shows the key exactly once", () => {
  it("creates it with the typed name, shows the key, and hides it after 'Ya la guardé'", async () => {
    const posted: unknown[] = [];
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.apiIntegration(() => ok(integration({ credentials: [] }))),
      handlers.issueCredential((body) => {
        posted.push(body);
        return ok(
          issueCredentialResponse.parse({
            credential: credential({ id: "cred-2", name: "ERP", keyTail: "ab12", lastUsedAt: null }),
            key: "dk_0123456789abcdef0123456789abab12",
          }),
          201,
        );
      }),
      handlers.integrations(() => ok({})),
    );
    renderApp("/integrations/api");

    expect(await screen.findByText(/todavía no tienes llaves/i)).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /crear llave/i });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Nombre"), "ERP");
    await userEvent.click(create);

    expect(await screen.findByText("dk_0123456789abcdef0123456789abab12")).toBeInTheDocument();
    expect(screen.getByText(/guarda esta llave ahora/i)).toBeInTheDocument();
    expect(posted).toEqual([{ name: "ERP" }]);

    await userEvent.click(screen.getByRole("button", { name: /ya la guardé/i }));
    expect(screen.queryByText("dk_0123456789abcdef0123456789abab12")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /crear llave/i })).toBeInTheDocument();
  });

  it("the wait sits inside <Pending>: the control announces 'Creando…' while the request runs", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.apiIntegration(() => ok(integration({ credentials: [] }))),
      http.post("/integrations/api/credentials", async () => {
        await delay(700);
        return HttpResponse.json({
          success: true,
          data: { credential: credential({ id: "cred-2", name: "ERP" }), key: "dk_0123456789abcdef0123456789abab12" },
        });
      }),
      handlers.integrations(() => ok({})),
    );
    renderApp("/integrations/api");
    await userEvent.type(await screen.findByLabelText("Nombre"), "ERP");
    await userEvent.click(screen.getByRole("button", { name: /crear llave/i }));
    expect(await screen.findByRole("button", { name: /creando…/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/creando la llave/i));
    expect(await screen.findByText("dk_0123456789abcdef0123456789abab12")).toBeInTheDocument();
  });
});

describe("FR-004: revoking takes effect", () => {
  it("asks once, posts the revocation, and the row reads Revocada", async () => {
    const revoked: string[] = [];
    let listed = integration();
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.apiIntegration(() => ok(listed)),
      handlers.revokeCredential((id) => {
        revoked.push(id);
        listed = integration({ credentials: [credential({ revokedAt: at })] });
        return ok({ credential: credential({ revokedAt: at }) });
      }),
      handlers.integrations(() => ok({})),
    );
    renderApp("/integrations/api");

    await userEvent.click(await screen.findByRole("button", { name: "Revocar" }));
    expect(screen.getByText(/dejarán de funcionar de inmediato/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sí, revocar/i }));
    expect(revoked).toEqual(["cred-1"]);
    expect(await screen.findByText("Revocada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revocar" })).not.toBeInTheDocument();
  });

  it("Cancelar keeps the credential", async () => {
    arrange();
    await userEvent.click(await screen.findByRole("button", { name: "Revocar" }));
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(screen.queryByText(/dejarán de funcionar/i)).not.toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
  });
});

describe("FR-009: the platform's own condition is a notice in Devolada's words", () => {
  it("says validation is unavailable on Devolada's side and that there is nothing to change", async () => {
    arrange(() => ok(integration({ validationAvailable: false })));
    const text = await screen.findByText(/no está disponible por ahora en devolada/i);
    /* a warning, announced politely — never an alert for a condition
       that is not the business's */
    const notice = text.closest("[role='status']")!;
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent(/no hay nada que cambiar de tu lado/i);
    await expectNoViolations(document.body);
  });

  it("shows no notice when validation is available", async () => {
    arrange();
    await screen.findByText("Sistema de facturación");
    expect(screen.queryByText(/no está disponible por ahora/i)).not.toBeInTheDocument();
  });
});
