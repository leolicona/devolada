import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { linksListQuery, payRequest } from "./schema";
import {
  getDirectPaymentStatus,
  getLinkStatus,
  listLinks,
  serveProof,
  submitPayment,
  uploadProof,
} from "./handler";

/* Pure router: validation + wiring only (code organization law).
   The customer-facing routes are public — the token IS the credential
   (D1); the admin list rides the session like every ISP endpoint. */
export const directPaymentsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Static /links first: it must win over /links/:token */
directPaymentsRoute.get("/links", requireSession, zValidator("query", linksListQuery), (c) => {
  return listLinks(c, c.req.valid("query").cursor);
});

directPaymentsRoute.get("/links/:token", (c) => {
  return getLinkStatus(c, c.req.param("token"));
});

directPaymentsRoute.post(
  "/links/:token/pay",
  zValidator("json", payRequest, (result, c) => {
    /* Public endpoint: Zod rejects answer in the project envelope */
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
    }
  }),
  (c) => {
    return submitPayment(c, c.req.param("token"), c.req.valid("json"));
  },
);

directPaymentsRoute.post("/links/:token/proof", (c) => {
  return uploadProof(c, c.req.param("token"));
});

directPaymentsRoute.get("/proofs/:linkId/:file", (c) => {
  return serveProof(c, c.req.param("linkId"), c.req.param("file"));
});

/* Param route last: the static prefixes above must win */
directPaymentsRoute.get("/:id/status", (c) => {
  return getDirectPaymentStatus(c, c.req.param("id"));
});
