import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { createLinkRequest, customerDebtQuery, customersQuery, payRequest, readProofRequest } from "./schema";
import {
  createLink,
  customerDebt,
  dismissPrune,
  getDirectPaymentStatus,
  getLinkStatus,
  listCustomers,
  pruneNotice,
  readProof,
  serveProof,
  submitPayment,
  uploadProof,
} from "./handler";

/* Pure router: validation + wiring only (code organization law).
   The customer-facing routes are public — the token IS the credential
   (D1); the admin list rides the session like every ISP endpoint. */
export const directPaymentsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* The project envelope for a rejected body or query (constitution III):
   zod's own 400 shape would be the one answer in the area that does not
   wear it. */
const invalid = (result: { success: boolean }, c: Ctx) => {
  if (!result.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }
};

/* links-on-demand-search D1 (FR-001): the ISP's CUSTOMERS, each with
   their link if one exists — browsing and searching through one door,
   because they answer the same question and differ only in how the rows
   were found. It replaces the roster, which is removed in Phase 7 once
   every test has moved across (D12). */
directPaymentsRoute.get(
  "/customers",
  requireSession,
  requireArea("payments", "read"),
  zValidator("query", customersQuery, invalid),
  (c) => {
    return listCustomers(c, c.req.valid("query"));
  },
);

/* cobros-in-links D9 (FR-017, FR-018): what one search result owes, read
   when it is shown. `payments: read`, like the customers door — a viewer
   reads it too. Registered right after `/customers` and before any
   parameterised pattern, so nothing can shadow it. */
directPaymentsRoute.get(
  "/customers/debt",
  requireSession,
  requireArea("payments", "read"),
  zValidator("query", customerDebtQuery, invalid),
  (c) => {
    return customerDebt(c, c.req.valid("query"));
  },
);

/* links-on-demand-search D8 (FR-008): the act. The only thing in the
   system that creates a panel link — and `payments: operate` is what
   the right to share means (FR-016), so a viewer never reaches it. */
directPaymentsRoute.post(
  "/links",
  requireSession,
  requireArea("payments", "operate"),
  zValidator("json", createLinkRequest, invalid),
  (c) => {
    return createLink(c, c.req.valid("json"));
  },
);

/* links-on-demand-search D13 (FR-023): the one-time cleanup's count,
   and the dismissal that ends it. The read is `payments: read`; the
   dismissal is `payments: operate`, stricter on purpose — a viewer
   should not silence, for everyone, the record of links that went. */
directPaymentsRoute.get("/prune-notice", requireSession, requireArea("payments", "read"), (c) => {
  return pruneNotice(c);
});

directPaymentsRoute.post(
  "/prune-notice/dismiss",
  requireSession,
  requireArea("payments", "operate"),
  (c) => {
    return dismissPrune(c);
  },
);

/* links-on-demand-search D12: `GET /links` and `GET /links/roster` are
   REMOVED. Both read the whole customer base and wrote a link for every
   row on every read — the cost this feature exists to end (FR-008). The
   customers door above replaces them; the payer's `/links/:token` below
   is a different resource entirely and is untouched. */
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

/* D18: read the uploaded proof so the payer can confirm it. Public like
   every customer-facing route here — the token is the credential. */
directPaymentsRoute.post(
  "/links/:token/read",
  zValidator("json", readProofRequest, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
    }
  }),
  (c) => {
    return readProof(c, c.req.param("token"), c.req.valid("json").proofId);
  },
);

directPaymentsRoute.get("/proofs/:linkId/:file", (c) => {
  return serveProof(c, c.req.param("linkId"), c.req.param("file"));
});

/* Param route last: the static prefixes above must win */
directPaymentsRoute.get("/:id/status", (c) => {
  return getDirectPaymentStatus(c, c.req.param("id"));
});
