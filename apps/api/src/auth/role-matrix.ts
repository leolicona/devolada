/* The role matrix (business-and-memberships spec D3), as the single
   source of truth. Areas, never buttons: a check names what part of the
   product the role may touch. Pure data + functions — the admin imports
   this too (`@devolada/api/role-matrix`), so it must never pull server
   code. The plugin's roles are DERIVED from it in roles.ts. */

export const AREAS = {
  payments: ["read", "operate"],
  settings: ["update"],
  clabe: ["update"],
  credit: ["manage"],
  integrations: ["manage"],
  members: ["invite_below_admin", "invite_any"],
  business: ["delete"],
} as const;

export type Area = keyof typeof AREAS;
export type Action<A extends Area = Area> = (typeof AREAS)[A][number];

export const ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/* Rank drives one rule only — D3's footnote: an admin grants roles below
   their own, so the owner stays the only source of admins. */
export const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, operator: 1, viewer: 0 };

type Grant = { [A in Area]?: readonly Action<A>[] };

export const MATRIX: Record<Role, Grant> = {
  owner: {
    payments: ["read", "operate"],
    settings: ["update"],
    clabe: ["update"],
    credit: ["manage"],
    integrations: ["manage"],
    members: ["invite_below_admin", "invite_any"],
    business: ["delete"],
  },
  admin: {
    payments: ["read", "operate"],
    settings: ["update"],
    integrations: ["manage"],
    members: ["invite_below_admin"],
  },
  operator: { payments: ["read", "operate"] },
  viewer: { payments: ["read"] },
};

export function roleCan<A extends Area>(role: Role, area: A, action: Action<A>): boolean {
  const granted = MATRIX[role][area] as readonly string[] | undefined;
  return Boolean(granted?.includes(action));
}

/* Which roles a granter may hand out (D3 footnote). */
export function grantableRoles(granter: Role): Role[] {
  if (granter === "owner") return [...ROLES];
  if (granter === "admin") return ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK.admin);
  return [];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

