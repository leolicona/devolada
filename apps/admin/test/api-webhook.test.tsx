import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { webhookIntegrationResponse } from "@devolada/api/integrations-schema";
import { handlers, businessActor, ok, server } from "./msw";
import { renderApp } from "./render";
import { expectNoViolations } from "./a11y";

/* automated-collections-api US2 (FR-018, research D10): the panel's
   webhook screen. A failing endpoint is visible with its reason, status
   is icon + text and never colour alone, the platform's own condition
   is worded as Devolada's, and axe passes. */

const at = Date.UTC(2026, 8, 17, 18, 30);

const delivery = (over: Record<string, unknown> = {}) => ({
  id: "dlv-1",
  eventId: "evt_0123",
  type: "payment.confirmed",
  paymentId: "pay-1",
  status: "delivered",
  attempts: 1,
  nextAttemptAt: null,
  responseStatus: 200,
  lastError: null,
  deliveredAt: at,
  createdAt: at - 5_000,
  ...over,
});

const endpoint = (over: Record<string, unknown> = {}) => ({
  url: "https://gym.example/hooks/devolada",
  createdAt: at - 86_400_000,
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastSuccessAt: at,
  ...over,
});

const response = (over: Record<string, unknown> = {}) =>
  webhookIntegrationResponse.parse({
    endpoint: endpoint(),
    signingConfigured: true,
    jwksUrl: "https://api.dev.devoladapago.com/.well-known/jwks.json",
    deliveries: [delivery()],
    ...over,
  });

const arrange = (r: () => ReturnType<typeof ok> = () => ok(response())) => {
  server.use(handlers.session(() => ok(businessActor)), handlers.webhookIntegration(r));
  renderApp("/integrations/api/webhook");
};

describe("FR-018: the health line", () => {
  it("a healthy endpoint: the address, 'Entregas al día' as icon + text, the delivery as 'Entregado', the key set named, and axe passes", async () => {
    arrange();
    expect(await screen.findByText("https://gym.example/hooks/devolada")).toBeInTheDocument();
    expect(screen.getByText("Entregas al día")).toBeInTheDocument();
    expect(screen.getByText("Entregado")).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /jwks\.json/ })).toHaveAttribute("href", "https://api.dev.devoladapago.com/.well-known/jwks.json");
    /* there is no secret on this screen (research D10) */
    expect(screen.queryByText(/secreto que copiar|whsec_/i)).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("a failing endpoint is visible with its reason, and the failed delivery says what the server answered", async () => {
    arrange(() =>
      ok(
        response({
          endpoint: endpoint({ consecutiveFailures: 3, lastFailureAt: at, lastSuccessAt: at - 3_600_000 }),
          deliveries: [
            delivery({ id: "dlv-2", status: "failed", attempts: 6, responseStatus: 503, lastError: "HTTP_503", deliveredAt: null }),
            delivery({ id: "dlv-3", type: "payment.validating", status: "pending", attempts: 2, responseStatus: null, lastError: "TIMEOUT", deliveredAt: null, nextAttemptAt: at + 900_000 }),
            delivery({ id: "dlv-4", type: "payment.partial", status: "pending", attempts: 1, responseStatus: null, lastError: "UNREACHABLE", deliveredAt: null, nextAttemptAt: at + 60_000 }),
          ],
        }),
      ),
    );
    expect(await screen.findByText("Entregas fallando")).toBeInTheDocument();
    const health = screen.getByRole("status");
    expect(health).toHaveTextContent(/los últimos 3 intentos fallaron/i);
    expect(health).toHaveTextContent(/responda con un código 2xx en menos de 10 segundos/i);
    expect(screen.getByText("Sin entregar")).toBeInTheDocument();
    expect(screen.getAllByText("Reintentando")).toHaveLength(2);
    expect(screen.getByText("Tu servidor respondió 503.")).toBeInTheDocument();
    expect(screen.getByText("Tu servidor no respondió en 10 segundos.")).toBeInTheDocument();
    expect(screen.getByText("No se pudo conectar con tu servidor.")).toBeInTheDocument();
    expect(screen.getByText("6 intentos")).toBeInTheDocument();
    /* the row's own words, never a synonym (research D17) */
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.queryByText("short")).not.toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("no address yet: says the system registers it itself, and shows no health badge", async () => {
    arrange(() => ok(response({ endpoint: null, deliveries: [] })));
    expect(await screen.findByText(/todavía no registra una dirección/i)).toBeInTheDocument();
    expect(screen.getByText("PUT /v1/webhook")).toBeInTheDocument();
    expect(screen.queryByText("Entregas al día")).not.toBeInTheDocument();
    expect(screen.queryByText("Entregas fallando")).not.toBeInTheDocument();
    expect(screen.getByText(/todavía no hay avisos/i)).toBeInTheDocument();
  });
});

describe("research D10 / constitution VIII: signing not configured is a visible state, worded as Devolada's", () => {
  it("shows the notice and that nothing is the business's to change", async () => {
    arrange(() =>
      ok(
        response({
          signingConfigured: false,
          deliveries: [delivery({ status: "pending", attempts: 0, responseStatus: null, lastError: "SIGNING_KEY_MISSING", deliveredAt: null })],
        }),
      ),
    );
    const text = await screen.findByText(/la firma de los webhooks no está configurada en devolada\./i, { selector: "strong" });
    const notice = text.closest("[role='status']")!;
    expect(notice).toHaveTextContent(/no hay nada que cambiar de tu lado/i);
    expect(screen.getByText("La firma de los webhooks no está configurada en Devolada.", { selector: "p" })).toBeInTheDocument();
    await expectNoViolations(document.body);
  });

  it("shows no notice when signing is configured", async () => {
    arrange();
    await screen.findByText("https://gym.example/hooks/devolada");
    expect(screen.queryByText(/no está configurada en devolada/i)).not.toBeInTheDocument();
  });
});

describe("the API screen points here", () => {
  it("links to the webhook's deliveries", async () => {
    server.use(
      handlers.session(() => ok(businessActor)),
      handlers.apiIntegration(() => ok({ credentials: [], validationAvailable: true })),
    );
    renderApp("/integrations/api");
    expect(await screen.findByRole("link", { name: /ver entregas/i })).toHaveAttribute("href", "/integrations/api/webhook");
  });
});
