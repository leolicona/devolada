import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requirePlatformOperator, requireSession } from "../../auth/middleware";
import {
  adjustmentRequest,
  correctionRequest,
  createStoreRequest,
  patchBusinessRequest,
  patchStoreRequest,
  setSettingRequest,
} from "./schema";
import {
  createStore,
  getStoreLedger,
  listStores,
  patchStore,
  postStoreCorrection,
  resendStoreInvitation,
  getPlatformBusiness,
  getPlatformSettings,
  getProviderQuota,
  listPlatformBusinesses,
  patchPlatformBusiness,
  postAdjustment,
  postPlatformSetting,
} from "./handler";
import { landingOperatorRoute } from "../landing";
import { readerOperatorRoute } from "../reader";

/* Pure router (operator-panel spec). Every route: session + operator. */
export const platformRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();
platformRoute.use("*", requireSession, requirePlatformOperator);

/* The envelope for a rejected body (constitution III). Inlined on a route
   with params, whose types a shared hook would widen (the house pattern,
   routes/direct-payments). */
const invalid = <C extends Context>(result: { success: boolean }, c: C) => {
  if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
};

platformRoute.get("/settings", (c) => getPlatformSettings(c));
/* payment-without-receipt D19: the provider's quota, for "Reglas" */
platformRoute.get("/provider-quota", (c) => getProviderQuota(c));
platformRoute.post("/settings/:key", zValidator("json", setSettingRequest), (c) =>
  postPlatformSetting(c, c.req.param("key"), c.req.valid("json").value),
);
platformRoute.get("/businesses", (c) => listPlatformBusinesses(c, c.req.query("q")));
platformRoute.get("/businesses/:id", (c) => getPlatformBusiness(c, c.req.param("id")));
platformRoute.patch("/businesses/:id", zValidator("json", patchBusinessRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }), (c) =>
  patchPlatformBusiness(c, c.req.param("id"), c.req.valid("json")),
);
platformRoute.post("/businesses/:id/adjustments", zValidator("json", adjustmentRequest), (c) => {
  const body = c.req.valid("json");
  return postAdjustment(c, c.req.param("id"), body.cents, body.reason);
});

/* landing-page D5/D17: the landing page's requests and counts, read by the
   operator's Landing tab. Mounted here so they sit behind this file's
   session + operator guard like every other platform read. */
platformRoute.route("/landing", landingOperatorRoute);

/* receipt-reader-tuning D18: the reader's model choice and test bench,
   read and written by the operator's Lector tab — behind the same guard. */
platformRoute.route("/reader", readerOperatorRoute);

/* cash-at-stores D4, D6, D21: the network's stores, their invitations and
   their cash books — behind the same guard (FR-001) */
platformRoute.get("/stores", (c) => listStores(c));
platformRoute.post("/stores", zValidator("json", createStoreRequest, invalid), (c) => createStore(c, c.req.valid("json")));
platformRoute.patch("/stores/:id", zValidator("json", patchStoreRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }), (c) =>
  patchStore(c, c.req.param("id"), c.req.valid("json")),
);
platformRoute.post("/stores/:id/invitation", (c) => resendStoreInvitation(c, c.req.param("id")));
platformRoute.get("/stores/:id/ledger/:businessId", (c) =>
  getStoreLedger(c, c.req.param("id"), c.req.param("businessId"), c.req.query("cursor")),
);
platformRoute.post("/stores/:id/ledger/:businessId/corrections", zValidator("json", correctionRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }), (c) =>
  postStoreCorrection(c, c.req.param("id"), c.req.param("businessId"), c.req.valid("json")),
);
