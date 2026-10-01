import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Bindings, Variables } from "../../env";
import { requireStore } from "../../auth/middleware";
import { recordCollectionRequest, storeQuoteQuery, storeSearchQuery } from "./schema";
import {
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
