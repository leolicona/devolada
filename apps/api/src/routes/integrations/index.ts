import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { wisphubPatchRequest, wisphubTestRequest } from "./schema";
import { getIntegrations, patchWisphub, testWisphubKey } from "./handler";

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
