import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { AREAS, MATRIX, ROLES, type Role } from "./role-matrix";

export * from "./role-matrix";

/* Plugin side (spike finding 2): our statements MUST spread the plugin's
   defaults, and owner/admin must carry its organization/member/invitation
   permissions — its own endpoints check them. Ours ride alongside. */
export const statements = { ...defaultStatements, ...AREAS } as const;
export const ac = createAccessControl(statements);

const pluginGrants: Record<Role, Record<string, readonly string[]>> = {
  owner: {
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  },
  admin: {
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  },
  operator: {},
  viewer: {},
};

export const pluginRoles = Object.fromEntries(
  ROLES.map((role) => [
    role,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ac.newRole({ ...pluginGrants[role], ...(MATRIX[role] as any) }),
  ]),
) as Record<Role, ReturnType<typeof ac.newRole>>;
