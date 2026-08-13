import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { decode, verify } from "hono/jwt";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Actor, Bindings, Variables } from "../env";
import { isps, tiendas } from "../db/schema";
import { AgnosticAuth } from "./agnostic";
import { COOKIE_ACCESS, COOKIE_REFRESH, limpiarSesionCookies, setSesionCookies } from "./cookies";

type Payload = { identity?: string; sub?: string; exp?: number };

/* Con AUTH_JWT_SECRET verifica firma HS256; sin él (solo dev)
   decodifica y valida expiración manualmente. */
async function leerPayload(jwt: string, env: Bindings): Promise<Payload | null> {
  try {
    if (env.AUTH_JWT_SECRET) {
      return (await verify(jwt, env.AUTH_JWT_SECRET, "HS256")) as Payload;
    }
    console.warn("AUTH_JWT_SECRET ausente: JWT decodificado sin verificar firma (solo dev)");
    const { payload } = decode(jwt);
    const p = payload as Payload;
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

async function buscarActor(env: Bindings, identity: string): Promise<Actor | null> {
  const db = drizzle(env.DB);
  const [tienda] = await db.select().from(tiendas).where(eq(tiendas.telefono, identity));
  if (tienda) {
    return {
      tipo: "tienda",
      id: tienda.id,
      ispId: tienda.ispId,
      nombre: tienda.nombre,
      telefono: tienda.telefono,
      estatus: tienda.estatus,
    };
  }
  const [isp] = await db.select().from(isps).where(eq(isps.correo, identity));
  if (isp) {
    return { tipo: "isp", id: isp.id, nombre: isp.nombre, correo: isp.correo, estatus: isp.estatus };
  }
  return null;
}

/* Sesión requerida: valida gm_access; si expiró y gm_refresh es válido,
   renueva en segundo plano, actualiza cookies y deja continuar la
   solicitud original. Verifica estatus en DB en cada solicitud:
   una suspensión revoca el acceso de inmediato. */
export const requireSesion = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const access = getCookie(c, COOKIE_ACCESS);
    const refresh = getCookie(c, COOKIE_REFRESH);

    let payload = access ? await leerPayload(access, c.env) : null;

    if (!payload && refresh) {
      try {
        const tokens = await new AgnosticAuth(c.env).refresh(refresh);
        payload = await leerPayload(tokens.jwt, c.env);
        if (payload) setSesionCookies(c, tokens);
      } catch {
        /* refresh inválido o revocado: cae al 401 de abajo */
      }
    }

    const identity = payload?.identity ?? payload?.sub;
    if (!identity) {
      limpiarSesionCookies(c);
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }

    const actor = await buscarActor(c.env, identity);
    if (!actor) {
      limpiarSesionCookies(c);
      return c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 401);
    }
    if (actor.estatus === "suspendida" || actor.estatus === "suspendido") {
      limpiarSesionCookies(c);
      return c.json({ success: false, error: { code: "CUENTA_SUSPENDIDA" } }, 403);
    }

    c.set("actor", actor);
    await next();
  },
);
