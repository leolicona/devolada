import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { settingsPatchRequest, wisphubTestRequest } from "./schema";
import { getSettings, patchSettings, testWispHubKey } from "./handler";

export const settingsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

settingsRoute.get("/", requireSession, (c) => getSettings(c));

settingsRoute.patch("/", requireSession, zValidator("json", settingsPatchRequest), (c) =>
  patchSettings(c, c.req.valid("json")),
);

settingsRoute.post("/wisphub/test", requireSession, zValidator("json", wisphubTestRequest), (c) =>
  testWispHubKey(c, c.req.valid("json").apiKey),
);
