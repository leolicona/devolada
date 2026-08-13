import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../env";

export const COOKIE_ACCESS = "gm_access";
export const COOKIE_REFRESH = "gm_refresh";

const QUINCE_MIN = 60 * 15;
const TREINTA_DIAS = 60 * 60 * 24 * 30;

function opcionesBase(env: Bindings) {
  return {
    httpOnly: true,
    secure: env.ENTORNO !== "dev",
    sameSite: "Lax" as const,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSesionCookies<E extends { Bindings: Bindings }>(
  c: Context<E>,
  tokens: { jwt: string; refreshToken: string },
) {
  const base = opcionesBase(c.env);
  setCookie(c, COOKIE_ACCESS, tokens.jwt, { ...base, maxAge: QUINCE_MIN });
  setCookie(c, COOKIE_REFRESH, tokens.refreshToken, { ...base, maxAge: TREINTA_DIAS });
}

export function limpiarSesionCookies<E extends { Bindings: Bindings }>(c: Context<E>) {
  const base = opcionesBase(c.env);
  deleteCookie(c, COOKIE_ACCESS, base);
  deleteCookie(c, COOKIE_REFRESH, base);
}
