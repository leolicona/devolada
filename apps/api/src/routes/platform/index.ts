import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requirePlatformOperator, requireSession } from "../../auth/middleware";
import { adjustmentRequest, patchBusinessRequest, setSettingRequest } from "./schema";
import {
  getPlatformBusiness,
  getPlatformSettings,
  listPlatformBusinesses,
  patchPlatformBusiness,
  postAdjustment,
  postPlatformSetting,
} from "./handler";

/* Pure router (operator-panel spec). Every route: session + operator. */
export const platformRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();
platformRoute.use("*", requireSession, requirePlatformOperator);

platformRoute.get("/settings", (c) => getPlatformSettings(c));
platformRoute.post("/settings/:key", zValidator("json", setSettingRequest), (c) =>
  postPlatformSetting(c, c.req.param("key"), c.req.valid("json").value),
);
platformRoute.get("/businesses", (c) => listPlatformBusinesses(c, c.req.query("q")));
platformRoute.get("/businesses/:id", (c) => getPlatformBusiness(c, c.req.param("id")));
platformRoute.patch("/businesses/:id", zValidator("json", patchBusinessRequest), (c) =>
  patchPlatformBusiness(c, c.req.param("id"), c.req.valid("json").feeOverrideCents),
);
platformRoute.post("/businesses/:id/adjustments", zValidator("json", adjustmentRequest), (c) => {
  const body = c.req.valid("json");
  return postAdjustment(c, c.req.param("id"), body.cents, body.reason);
});
