import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { isps, stores } from "../db/schema";
import { AgnosticAuth } from "../auth/agnostic";

/* Dev-only routes: index.ts mounts them solely when ENVIRONMENT === "dev".
   Seeds a demo ISP and store to verify login with curl. */

export const dev = new Hono<{ Bindings: Bindings }>();

const DEMO = {
  ispEmail: "demo@devolada.app",
  storePhone: "5512345678",
  password: "devolada123",
};

dev.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);
  const { hash, salt } = await new AgnosticAuth(c.env).hash(DEMO.password);

  let [isp] = await db.select().from(isps).where(eq(isps.email, DEMO.ispEmail));
  if (!isp) {
    [isp] = await db
      .insert(isps)
      .values({
        name: "ISP Demo",
        email: DEMO.ispEmail,
        emailVerified: true,
        passwordHash: hash,
        passwordSalt: salt,
        wisphubApiKey: c.env.WISPHUB_API_KEY ?? null,
      })
      .returning();
  }

  const [existingStore] = await db
    .select()
    .from(stores)
    .where(eq(stores.phone, DEMO.storePhone));
  if (!existingStore) {
    await db.insert(stores).values({
      ispId: isp.id,
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: DEMO.storePhone,
      zone: "Col. El Mirador",
      passwordHash: hash,
      passwordSalt: salt,
      status: "active",
    });
  }

  return c.json({
    success: true,
    data: {
      admin: { email: DEMO.ispEmail, password: DEMO.password },
      store: { phone: DEMO.storePhone, password: DEMO.password },
    },
  });
});
