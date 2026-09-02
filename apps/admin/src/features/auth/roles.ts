import type { Role } from "@devolada/api/role-matrix";

/* The glossary's es-MX names for the four roles (SPEC.md) — one place,
   read by Usuarios and by the invitation page. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dueño",
  admin: "Administrador",
  operator: "Operador",
  viewer: "Lector",
};
