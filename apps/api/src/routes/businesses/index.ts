import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { createBusinessRequest, inviteMemberRequest } from "./schema";
import { createBusiness, inviteMember, listMembers, removeMember } from "./handler";

/* Pure router: validation + wiring only (code organization law). */
export const businessesRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Creating a business needs a user, not a business: no requireSession
   (which demands a membership) — the handler resolves the session itself. */
businessesRoute.post("/", zValidator("json", createBusinessRequest), (c) => {
  return createBusiness(c, c.req.valid("json"));
});

businessesRoute.get("/members", requireSession, (c) => listMembers(c));

businessesRoute.post(
  "/members",
  requireSession,
  requireArea("members", "invite_below_admin"),
  zValidator("json", inviteMemberRequest),
  (c) => inviteMember(c, c.req.valid("json")),
);

businessesRoute.delete(
  "/members/:memberId",
  requireSession,
  requireArea("members", "invite_below_admin"),
  (c) => removeMember(c, c.req.param("memberId")),
);
