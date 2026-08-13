import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { isps, tiendas } from "../db/schema";
import { AgnosticAuth } from "../auth/agnostic";

/* Rutas solo-dev: index.ts las monta únicamente cuando ENTORNO === "dev".
   Siembra un ISP y una tienda de prueba para verificar login con curl. */

export const dev = new Hono<{ Bindings: Bindings }>();

const DEMO = {
  ispCorreo: "demo@devolada.app",
  tiendaTelefono: "5512345678",
  password: "devolada123",
};

dev.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);
  const { hash, salt } = await new AgnosticAuth(c.env).hash(DEMO.password);

  let [isp] = await db.select().from(isps).where(eq(isps.correo, DEMO.ispCorreo));
  if (!isp) {
    [isp] = await db
      .insert(isps)
      .values({
        nombre: "ISP Demo",
        correo: DEMO.ispCorreo,
        correoVerificado: true,
        passwordHash: hash,
        passwordSalt: salt,
      })
      .returning();
  }

  const [tiendaExistente] = await db
    .select()
    .from(tiendas)
    .where(eq(tiendas.telefono, DEMO.tiendaTelefono));
  if (!tiendaExistente) {
    await db.insert(tiendas).values({
      ispId: isp.id,
      nombre: "Abarrotes La Esquina",
      responsable: "Don Chuy",
      telefono: DEMO.tiendaTelefono,
      zona: "Col. El Mirador",
      passwordHash: hash,
      passwordSalt: salt,
      estatus: "activa",
    });
  }

  return c.json({
    success: true,
    data: {
      admin: { correo: DEMO.ispCorreo, password: DEMO.password },
      tienda: { telefono: DEMO.tiendaTelefono, password: DEMO.password },
    },
  });
});
