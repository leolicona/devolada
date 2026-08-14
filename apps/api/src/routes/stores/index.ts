import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireSession } from "../../auth/middleware";
import { storeCreateRequest, storePatchRequest } from "./schema";
import { createStore, getStore, getStoreLedger, listStores, patchStore, resendInvitation } from "./handler";

export const storesRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

storesRoute.get("/", requireSession, (c) => listStores(c));
storesRoute.post("/", requireSession, zValidator("json", storeCreateRequest), (c) =>
  createStore(c, c.req.valid("json")),
);
storesRoute.get("/:id", requireSession, (c) => getStore(c, c.req.param("id")));
storesRoute.patch("/:id", requireSession, zValidator("json", storePatchRequest), (c) =>
  patchStore(c, c.req.param("id"), c.req.valid("json")),
);
storesRoute.post("/:id/resend-invitation", requireSession, (c) =>
  resendInvitation(c, c.req.param("id")),
);
storesRoute.get("/:id/ledger", requireSession, (c) => {
  const cursor = c.req.query("cursor");
  return getStoreLedger(c, c.req.param("id"), cursor ? Number(cursor) : undefined);
});
