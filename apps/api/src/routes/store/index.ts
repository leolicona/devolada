import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireStore } from "../../auth/middleware";
import { rateLimitRoute } from "../../auth/rate-limit";
import {
  acceptStoreInvitationRequest,
  storeInvitationCodeRequest,
  storeSignInCodeRequest,
  storeSignInRequest,
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
  sendInvitationCode,
  sendSignInCode,
  signInWithCode,
} from "./handler";

/* cash-at-stores — the shopkeeper's area. Pure router: validation and
   wiring only (constitution III). `requireStore` (D2) guards every route
   but the session-less doors: the invitation's and, since
   passwordless-access D10, the sign-in by phone. */
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
   and every door carries the Hono limiter Better Auth's never sees — a
   Better Auth call made from our server skips its limiter (better-auth
   D11's known gap) ---- */

storeRoute.get("/invitations/:token", rateLimitRoute("store-invitation", { window: 60, max: 30 }), (c) =>
  previewInvitation(c, c.req.param("token")),
);

/* passwordless-access D10: the invitation is an email and its código. D3:
   asking for one is 3 per 60 s — what stops a script from filling an
   inbox — and typing one keeps the acceptance's 5 per 60 s. */
storeRoute.post(
  "/invitations/:token/code",
  rateLimitRoute("store-invitation-code", { window: 60, max: 3 }),
  /* inline: a shared hook typed without the `:token` param would erase it */
  zValidator("json", storeInvitationCodeRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => sendInvitationCode(c, c.req.param("token"), c.req.valid("json")),
);

storeRoute.post(
  "/invitations/:token/accept",
  rateLimitRoute("store-invitation-accept", { window: 60, max: 5 }),
  /* inline: a shared hook typed without the `:token` param would erase it */
  zValidator("json", acceptStoreInvitationRequest, (result, c) => {
    if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
  }),
  (c) => acceptInvitation(c, c.req.param("token"), c.req.valid("json")),
);

/* ---- The sign-in by phone, session-less (passwordless-access D10): the
   phone finds the store, the código goes to its email. D3: the same two
   limits as the invitation's código and acceptance ---- */

storeRoute.post(
  "/sign-in/code",
  rateLimitRoute("store-sign-in-code", { window: 60, max: 3 }),
  zValidator("json", storeSignInCodeRequest, invalid),
  (c) => sendSignInCode(c, c.req.valid("json")),
);

storeRoute.post(
  "/sign-in",
  rateLimitRoute("store-sign-in", { window: 60, max: 5 }),
  zValidator("json", storeSignInRequest, invalid),
  (c) => signInWithCode(c, c.req.valid("json")),
);
