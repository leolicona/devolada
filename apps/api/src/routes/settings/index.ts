import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { settingsPatchRequest } from "./schema";
import { getSettings, patchSettings } from "./handler";

export const settingsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

settingsRoute.get("/", requireSession, (c) => getSettings(c));

/* business-and-memberships D3: settings are owner/admin; the CLABE is the
   owner's alone — the handler checks that finer area on the body. */
settingsRoute.patch(
  "/",
  requireSession,
  requireArea("settings", "update"),
  zValidator("json", settingsPatchRequest),
  (c) => patchSettings(c, c.req.valid("json")),
);

