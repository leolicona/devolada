export type Bindings = {
  DB: D1Database;
  /* Service binding en producción; en dev se usa AUTH_BASE_URL por HTTP */
  AGNOSTIC_AUTH_API?: Fetcher;
  AUTH_BASE_URL: string;
  AUTH_APP_ID: string;
  /* Secreto HS256 con el que agnostic-auth firma los JWT.
     Sin él (solo dev) los tokens se decodifican sin verificar firma. */
  AUTH_JWT_SECRET?: string;
  COOKIE_DOMAIN?: string;
  ENTORNO?: "dev" | "prod";
};

export type Actor =
  | {
      tipo: "tienda";
      id: string;
      ispId: string;
      nombre: string;
      telefono: string;
      estatus: "invitada" | "activa" | "suspendida";
    }
  | {
      tipo: "isp";
      id: string;
      nombre: string;
      correo: string;
      estatus: "activo" | "suspendido";
    };

export type Variables = {
  actor: Actor;
};
