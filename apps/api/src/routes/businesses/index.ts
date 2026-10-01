import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { requireArea, requireSession } from "../../auth/middleware";
import { rateLimitRoute } from "../../auth/rate-limit";
import {
  acceptInvitationNewRequest,
  createBusinessRequest,
  inviteMemberRequest,
  updateMemberRoleRequest,
} from "./schema";
import {
  acceptInvitationAsNewUser,
  cancelInvitation,
  createBusiness,
  inviteMember,
  listMembers,
  myInvitations,
  previewInvitation,
  removeMember,
  resendInvitation,
  updateMemberRole,
} from "./handler";

export const businessesRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* Creating a business needs a user, not a business: no requireSession
   (which demands a membership) — the handler resolves the session itself. */
businessesRoute.post("/", zValidator("json", createBusinessRequest), (c) => {
  return createBusiness(c, c.req.valid("json"));
});

/* D11: every member reads the team; the email rides only for inviters */
businessesRoute.get("/members", requireSession, requireArea("members", "read"), (c) => listMembers(c));

businessesRoute.post(
  "/members",
  requireSession,
  requireArea("members", "invite_below_admin"),
  zValidator("json", inviteMemberRequest),
  (c) => inviteMember(c, c.req.valid("json")),
);

/* D12: role change, same rank rule as invite and remove */
businessesRoute.patch(
  "/members/:memberId",
  requireSession,
  requireArea("members", "invite_below_admin"),
  zValidator("json", updateMemberRoleRequest),
  (c) => updateMemberRole(c, c.req.param("memberId"), c.req.valid("json")),
);

businessesRoute.delete(
  "/members/:memberId",
  requireSession,
  requireArea("members", "invite_below_admin"),
  (c) => removeMember(c, c.req.param("memberId")),
);

/* D8: the invitation's lifecycle in the inviter's hands */
businessesRoute.post(
  "/invitations/:invitationId/resend",
  requireSession,
  requireArea("members", "invite_below_admin"),
  (c) => resendInvitation(c, c.req.param("invitationId")),
);
businessesRoute.delete(
  "/invitations/:invitationId",
  requireSession,
  requireArea("members", "invite_below_admin"),
  (c) => cancelInvitation(c, c.req.param("invitationId")),
);

/* bug: invitee-lands-own-business — the invitations sent to me. No
   requireSession: it demands a membership, and the wizard asks before
   one exists; the handler resolves the session itself. */
businessesRoute.get("/invitations/mine", (c) => myInvitations(c));

/* D14 (better-auth.spec.md): the two session-less doors of the
   invitation page. The id is the key — random, sent by email only —
   and D15's tope stands in front of both. */
businessesRoute.get(
  "/invitations/:invitationId/preview",
  rateLimitRoute("invitation-preview", { window: 60, max: 30 }),
  (c) => previewInvitation(c, c.req.param("invitationId")),
);
businessesRoute.post(
  "/invitations/:invitationId/accept-new",
  rateLimitRoute("invitation-accept-new", { window: 60, max: 5 }),
  zValidator("json", acceptInvitationNewRequest),
  (c) => acceptInvitationAsNewUser(c, c.req.param("invitationId"), c.req.valid("json")),
);
