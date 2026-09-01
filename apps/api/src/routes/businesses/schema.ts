import { z } from "zod";
import { BANKS } from "../../direct-payments/banks";
import { ROLES } from "../../auth/roles";

/* Shareable contract (ARCHITECTURE.md): the admin derives its types here. */

/* business-and-memberships D5: the onboarding minimum, persisted in one
   call at wizard completion — never at step 1. The bank is a pick from the
   provider vocabulary (direct-payment D16, BUG-007), never free text. */
export const createBusinessRequest = z.object({
  name: z.string().trim().min(2).max(120),
  speiClabe: z.string().trim().regex(/^\d{18}$/),
  speiBank: z.string().trim().pipe(z.enum(BANKS)),
  speiBeneficiaryName: z.string().trim().min(3).max(120).nullable().optional(),
});

export const role = z.enum(ROLES);

export const inviteMemberRequest = z.object({
  email: z.string().trim().email(),
  role,
});

export const memberItem = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role,
  createdAt: z.number().int(),
});

export const membersResponse = z.object({
  members: z.array(memberItem),
  /* Roles the caller may hand out (D3 footnote) — the UI hides the rest */
  grantable: z.array(role),
});

export type CreateBusinessRequest = z.infer<typeof createBusinessRequest>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequest>;
export type MembersResponse = z.infer<typeof membersResponse>;
