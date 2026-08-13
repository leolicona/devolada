import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../env";

export const COOKIE_ACCESS = "gm_access";
export const COOKIE_REFRESH = "gm_refresh";

const FIFTEEN_MIN = 60 * 15;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function baseOptions(env: Bindings) {
  return {
    httpOnly: true,
    secure: env.ENVIRONMENT !== "dev",
    sameSite: "Lax" as const,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookies<E extends { Bindings: Bindings }>(
  c: Context<E>,
  tokens: { jwt: string; refreshToken: string },
) {
  const base = baseOptions(c.env);
  setCookie(c, COOKIE_ACCESS, tokens.jwt, { ...base, maxAge: FIFTEEN_MIN });
  setCookie(c, COOKIE_REFRESH, tokens.refreshToken, { ...base, maxAge: THIRTY_DAYS });
}

export function clearSessionCookies<E extends { Bindings: Bindings }>(c: Context<E>) {
  const base = baseOptions(c.env);
  deleteCookie(c, COOKIE_ACCESS, base);
  deleteCookie(c, COOKIE_REFRESH, base);
}
