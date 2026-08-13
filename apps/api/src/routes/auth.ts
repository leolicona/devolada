import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../env";
import { isps, tiendas } from "../db/schema";
import { AgnosticAuth, ErrorAuth } from "../auth/agnostic";
import { COOKIE_REFRESH, limpiarSesionCookies, setSesionCookies } from "../auth/cookies";
import { requireSesion } from "../auth/middleware";

export const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const credencialesTienda = z.object({
  telefono: z.string().min(10).max(15),
  password: z.string().min(8),
});

const credencialesAdmin = z.object({
  correo: z.string().email(),
  password: z.string().min(8),
});

/* 401 idéntico exista o no la cuenta: no filtrar qué teléfonos/correos existen */
const noAutorizado = { success: false, error: { code: "AUTHENTICATION_ERROR" } } as const;

auth.post("/tienda/login", zValidator("json", credencialesTienda), async (c) => {
  const { telefono, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  const [tienda] = await db.select().from(tiendas).where(eq(tiendas.telefono, telefono));
  if (!tienda?.passwordHash || !tienda.passwordSalt) return c.json(noAutorizado, 401);
  if (tienda.estatus === "suspendida") {
    return c.json({ success: false, error: { code: "CUENTA_SUSPENDIDA" } }, 403);
  }

  try {
    const tokens = await new AgnosticAuth(c.env).verifyPassword(
      telefono,
      password,
      tienda.passwordHash,
      tienda.passwordSalt,
    );
    setSesionCookies(c, tokens);
    return c.json({
      success: true,
      data: { tipo: "tienda", id: tienda.id, nombre: tienda.nombre },
    });
  } catch (e) {
    /* Solo credenciales inválidas son 401; errores de configuración
       (app no registrada, validación) deben ser visibles, no un 401 falso */
    if (e instanceof ErrorAuth && e.status === 401) return c.json(noAutorizado, 401);
    throw e;
  }
});

auth.post("/admin/login", zValidator("json", credencialesAdmin), async (c) => {
  const { correo, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  const [isp] = await db.select().from(isps).where(eq(isps.correo, correo));
  if (!isp?.passwordHash || !isp.passwordSalt) return c.json(noAutorizado, 401);
  if (isp.estatus === "suspendido") {
    return c.json({ success: false, error: { code: "CUENTA_SUSPENDIDA" } }, 403);
  }

  try {
    const tokens = await new AgnosticAuth(c.env).verifyPassword(
      correo,
      password,
      isp.passwordHash,
      isp.passwordSalt,
    );
    setSesionCookies(c, tokens);
    return c.json({ success: true, data: { tipo: "isp", id: isp.id, nombre: isp.nombre } });
  } catch (e) {
    if (e instanceof ErrorAuth && e.status === 401) return c.json(noAutorizado, 401);
    throw e;
  }
});

auth.post("/logout", async (c) => {
  const refresh = getCookie(c, COOKIE_REFRESH);
  if (refresh) {
    try {
      await new AgnosticAuth(c.env).revoke(refresh);
    } catch {
      /* revocación es mejor-esfuerzo; las cookies se limpian igual */
    }
  }
  limpiarSesionCookies(c);
  return c.json({ success: true, data: {} });
});

auth.get("/me", requireSesion, (c) => {
  return c.json({ success: true, data: c.get("actor") });
});
