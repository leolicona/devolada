import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses, member, organization, user as userTable } from "../db/schema";
import { makeAuth } from "../auth/better";
import { queuedCount, sweepReconnections } from "../reconnection/queue";
import { sweepDirectPayments, validatingCount } from "../direct-payments/validation";

/* Dev-only routes: index.ts mounts them solely when ENVIRONMENT === "dev".
   Seeds a demo ISP to verify login with curl. */

export const dev = new Hono<{ Bindings: Bindings }>();

const DEMO = {
  ispEmail: "demo@devolada.app",
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

  /* Creates the Better Auth user (email pre-verified: demo data) and
     returns its id. The signup OTP goes to the console — harmless. */
  async function seedUser(name: string, email: string) {
    const { response } = await ba.api.signUpEmail({
      body: { name, email, password: DEMO.password },
      returnHeaders: true,
    });
    await db
      .update(userTable)
      .set({ emailVerified: true })
      .where(eq(userTable.id, response.user.id));
    return response.user.id;
  }

  let [demoUser] = await db.select().from(userTable).where(eq(userTable.email, DEMO.ispEmail));
  const userId = demoUser ? demoUser.id : await seedUser("ISP Demo", DEMO.ispEmail);

  let [business] = await db.select().from(businesses).where(eq(businesses.email, DEMO.ispEmail));
  /* Idempotent, but the WispHub key must refresh: the demo business may
     have been seeded before the key existed in the environment */
  if (business && !business.wisphubApiKey && c.env.WISPHUB_API_KEY) {
    await db
      .update(businesses)
      .set({ wisphubApiKey: c.env.WISPHUB_API_KEY })
      .where(eq(businesses.id, business.id));
  }
  if (!business) {
    /* The server-side door (spike): organization + owner membership as
       rows, no plugin session needed — same shape the D7 backfill wrote */
    const orgId = `org_${crypto.randomUUID()}`;
    const now = new Date();
    await db.insert(organization).values({ id: orgId, name: "ISP Demo", slug: `negocio-demo`, createdAt: now });
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: now,
    });
    [business] = await db
      .insert(businesses)
      .values({
        name: "ISP Demo",
        email: DEMO.ispEmail,
        orgId,
        wisphubApiKey: c.env.WISPHUB_API_KEY ?? null,
      })
      .returning();
  }

  return c.json({
    success: true,
    data: {
      admin: { email: DEMO.ispEmail, password: DEMO.password },
    },
  });
});
