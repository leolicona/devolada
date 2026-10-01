import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireStore } from "../../auth/middleware";
import { rateLimitRoute } from "../../auth/rate-limit";
import {
  acceptStoreInvitationRequest,
  declareHandoverRequest,
  recordCollectionRequest,
  storeLedgerQuery,
  storeHandoversQuery,
  storeQuoteQuery,
  storeSearchQuery,
} from "./schema";
import {
  acceptInvitation,
  declareHandover,
  getCashbox,
  getStoreLedger,
  getStoreHandovers,
  previewInvitation,
  collectionReceipt,
  collectionStatus,
  quoteCustomer,
  recordStoreCollection,
  searchCustomers,
} from "./handler";

/* cash-at-stores — the shopkeeper's area. Pure router: validation and
   wiring only (constitution III). `requireStore` (D2) guards every route
   but the two invitation doors. */
export const storeRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* The envelope for a rejected body or query (constitution III) */
const invalid = (result: { success: boolean }, c: Ctx) => {
  if (!result.success) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }
};

/* ---- The counter (D8, D14, D24, D25) ---- */

storeRoute.get("/customers", requireStore, zValidator("query", storeSearchQuery, invalid), (c) =>
  searchCustomers(c, c.req.valid("query").q),
);

/* Before any parameterised pattern, so nothing shadows it */
storeRoute.get("/customers/debt", requireStore, zValidator("query", storeQuoteQuery, invalid), (c) =>
  quoteCustomer(c, c.req.valid("query").usuario),
);

storeRoute.post("/collections", requireStore, zValidator("json", recordCollectionRequest, invalid), (c) =>
  recordStoreCollection(c, c.req.valid("json")),
);

storeRoute.get("/collections/:id", requireStore, (c) => collectionStatus(c, c.req.param("id")));

storeRoute.get("/collections/:id/receipt", requireStore, (c) => collectionReceipt(c, c.req.param("id")));

/* ---- The cash book (D19, D20): served for every business the store has
   movements with, channel on or off (contract, H1) ---- */

storeRoute.get("/cashbox", requireStore, (c) => getCashbox(c));

storeRoute.get("/ledger", requireStore, zValidator("query", storeLedgerQuery, invalid), (c) =>
  getStoreLedger(c, c.req.valid("query")),
);

storeRoute.post("/handovers", requireStore, zValidator("json", declareHandoverRequest, invalid), (c) =>
  declareHandover(c, c.req.valid("json")),
);

/* T080: the store's own hand-over history, disputes and notes included */
storeRoute.get("/handovers", requireStore, zValidator("query", storeHandoversQuery, invalid), (c) =>
  getStoreHandovers(c, c.req.valid("query")),
);

/* ---- The invitation, session-less (D4, D5): the token is the credential,
   and both doors carry the Hono limiter Better Auth's never sees ---- */

storeRoute.get("/invitations/:token", rateLimitRoute("store-invitation", { window: 60, max: 30 }), (c) =>
  previewInvitation(c, c.req.param("token")),
);

storeRoute.post(
  "/invitations/:token/accept",
  rateLimitRoute("store-invitation-accept", { window: 60, max: 5 }),
  zValidator("json", acceptStoreInvitationRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => acceptInvitation(c, c.req.param("token"), c.req.valid("json")),
);
