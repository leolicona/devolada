import { z } from "zod";
import { BANKS } from "../../direct-payments/banks";
import { ROLES } from "../../auth/roles";

/* Shareable contract (ARCHITECTURE.md): the admin derives its types here. */

/* business-and-memberships D5 (owner, 2026-09-02): the business is born
   with its name alone; the CLABE is configured afterwards in
   Configuración. The two SPEI fields still travel together when they
   travel at all — a CLABE without its bank poisons every validation
   (direct-payment D16, BUG-007). */
export const createBusinessRequest = z
  .object({
    name: z.string().trim().min(2).max(120),
    speiClabe: z.string().trim().regex(/^\d{18}$/).optional(),
    speiBank: z.string().trim().pipe(z.enum(BANKS)).optional(),
    speiBeneficiaryName: z.string().trim().min(3).max(120).nullable().optional(),
  })
  .refine((b) => Boolean(b.speiClabe) === Boolean(b.speiBank), {
    message: "CLABE and bank travel together",
  });

export const role = z.enum(ROLES);

export const inviteMemberRequest = z.object({
  email: z.string().trim().email(),
  role,
});

export const updateMemberRoleRequest = z.object({ role });

export const memberItem = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  /* D11: null for readers who may not invite — the email is the
     inviter's tool, not the team's directory */
  email: z.string().nullable(),
  role,
  createdAt: z.number().int(),
});

/* D8: a pending invitation, alive or expired (the plugin keeps expired
   rows `pending`; the screen names them "Vencida" and offers resend) */
export const pendingInvitation = z.object({
  id: z.string(),
  email: z.string(),
  role,
  expiresAt: z.number().int(),
  expired: z.boolean(),
});

export const membersResponse = z.object({
  members: z.array(memberItem),
  /* Roles the caller may hand out (D3 footnote) — the UI hides the rest */
  grantable: z.array(role),
  /* Empty for those who may not invite */
  pending: z.array(pendingInvitation),
});

/* D14 (better-auth.spec.md): what the invitation page reads before it
   shows anything — the page decides for the invitee */
export const invitationPreviewResponse = z.object({
  status: z.enum(["pending", "expired", "gone"]),
  businessName: z.string().nullable(),
  role: role.nullable(),
  email: z.string().nullable(),
  hasAccount: z.boolean(),
});

export const acceptInvitationNewRequest = z.object({
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8),
});

export type CreateBusinessRequest = z.infer<typeof createBusinessRequest>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequest>;
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequest>;
export type MembersResponse = z.infer<typeof membersResponse>;
export type PendingInvitation = z.infer<typeof pendingInvitation>;
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponse>;
export type AcceptInvitationNewRequest = z.infer<typeof acceptInvitationNewRequest>;
