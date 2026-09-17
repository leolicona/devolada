import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { issueCredentialRequest, wisphubPatchRequest, wisphubTestRequest } from "./schema";
import {
  getApiIntegration,
  getIntegrations,
  issueApiCredential,
  patchWisphub,
  revokeApiCredential,
  testWisphubKey,
} from "./handler";

/* Pure router (code organization law). The hub is owner/admin territory
   (integrations: manage); operators and viewers read outcomes in Pagos
   (integrations-hub D1). */
export const integrationsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

integrationsRoute.get("/", requireSession, requireArea("integrations", "manage"), (c) => {
  return getIntegrations(c);
});

integrationsRoute.patch(
  "/wisphub",
  requireSession,
  requireArea("integrations", "manage"),
  zValidator("json", wisphubPatchRequest),
  (c) => patchWisphub(c, c.req.valid("json")),
);

integrationsRoute.post(
  "/wisphub/test",
  requireSession,
  requireArea("integrations", "manage"),
  zValidator("json", wisphubTestRequest),
  (c) => testWisphubKey(c, c.req.valid("json").apiKey),
);

/* automated-collections-api US1: the API card — credentials issued,
   listed by tail and revoked from the panel (FR-001, FR-003, FR-004).
   Same area as the hub: a credential lets software act for the business. */
integrationsRoute.get("/api", requireSession, requireArea("integrations", "manage"), (c) => {
  return getApiIntegration(c);
});

integrationsRoute.post(
  "/api/credentials",
  requireSession,
  requireArea("integrations", "manage"),
  zValidator("json", issueCredentialRequest),
  (c) => issueApiCredential(c, c.req.valid("json")),
);

integrationsRoute.post(
  "/api/credentials/:id/revoke",
  requireSession,
  requireArea("integrations", "manage"),
  (c) => revokeApiCredential(c, c.req.param("id")),
);
