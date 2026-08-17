import { Hono } from "hono";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { isps, stores, user as userTable } from "../db/schema";
import { makeAuth } from "../auth/better";
import { queuedCount, sweepReconnections } from "../reconnection/queue";
import { sweepDirectPayments, validatingCount } from "../direct-payments/validation";

/* Dev-only routes: index.ts mounts them solely when ENVIRONMENT === "dev".
   Seeds a demo ISP and store to verify login with curl. */

export const dev = new Hono<{ Bindings: Bindings }>();

const DEMO = {
  ispEmail: "demo@devolada.app",
  storeEmail: "tienda@devolada.app",
  storePhone: "5512345678",
  password: "devolada123",
};

/* D7: one sweep on demand — waiting a minute for cron while standing
   next to a pilot ISP's router is a bad way to spend a visit. */
dev.post("/reconnect-sweep", async (c) => {
  const report = await sweepReconnections(c.env);
  return c.json({ success: true, data: { ...report, queued: await queuedCount(c.env) } });
});

/* Same escape hatch for the direct-payment re-validations (D7) */
dev.post("/direct-payment-sweep", async (c) => {
  const report = await sweepDirectPayments(c.env);
  return c.json({ success: true, data: { ...report, validating: await validatingCount(c.env) } });
});

dev.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);
  const ba = makeAuth(c.env);

  /* Repair pass for pre-migration rows: an isps row with no user whose
     email already has a Better Auth user (an orphan left by the old
     signup bug) gets linked instead of staying unreachable. The user
     keeps whatever password they set — recovery included. */
  const unlinked = await db.select().from(isps).where(isNull(isps.userId));
  for (const row of unlinked) {
    const [orphan] = await db.select().from(userTable).where(eq(userTable.email, row.email));
    if (orphan) {
      await db.update(isps).set({ userId: orphan.id }).where(eq(isps.id, row.id));
      console.log(`seed: linked legacy isp ${row.email} to its orphan user`);
    }
  }

  /* Creates the Better Auth user (email pre-verified: demo data) and
     returns its id. The signup OTP goes to the console — harmless. */
  async function seedUser(name: string, email: string, username?: string) {
    const { response } = await ba.api.signUpEmail({
      body: { name, email, password: DEMO.password, ...(username ? { username } : {}) },
      returnHeaders: true,
    });
    await db
      .update(userTable)
      .set({ emailVerified: true })
      .where(eq(userTable.id, response.user.id));
    return response.user.id;
  }

  let [isp] = await db.select().from(isps).where(eq(isps.email, DEMO.ispEmail));
  /* Idempotent, but the WispHub key must refresh: the demo ISP may have
     been seeded before the key existed in the environment */
  if (isp && !isp.wisphubApiKey && c.env.WISPHUB_API_KEY) {
    await db
      .update(isps)
      .set({ wisphubApiKey: c.env.WISPHUB_API_KEY })
      .where(eq(isps.id, isp.id));
  }
  /* Rows seeded before the Better Auth migration exist without a user
     (user_id NULL after migration 0004): backfill so login works again */
  if (isp && !isp.userId) {
    const userId = await seedUser("ISP Demo", DEMO.ispEmail);
    await db.update(isps).set({ userId }).where(eq(isps.id, isp.id));
  }
  if (!isp) {
    const userId = await seedUser("ISP Demo", DEMO.ispEmail);
    [isp] = await db
      .insert(isps)
      .values({
        name: "ISP Demo",
        email: DEMO.ispEmail,
        userId,
        wisphubApiKey: c.env.WISPHUB_API_KEY ?? null,
      })
      .returning();
  }

  const [existingStore] = await db
    .select()
    .from(stores)
    .where(eq(stores.phone, DEMO.storePhone));
  if (existingStore && !existingStore.userId) {
    const userId = await seedUser("Don Chuy", DEMO.storeEmail, DEMO.storePhone);
    await db.update(stores).set({ userId }).where(eq(stores.id, existingStore.id));
  }
  if (!existingStore) {
    const userId = await seedUser("Don Chuy", DEMO.storeEmail, DEMO.storePhone);
    await db.insert(stores).values({
      ispId: isp.id,
      name: "Abarrotes La Esquina",
      contactName: "Don Chuy",
      phone: DEMO.storePhone,
      zone: "Col. El Mirador",
      userId,
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
