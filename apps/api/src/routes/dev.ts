import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import { businesses, invitation, member, organization, user as userTable, verification } from "../db/schema";
import { upsertIntegration } from "../integrations/store";
import { makeAuth } from "../auth/better";
import { queuedCount, sweepReconnections } from "../reconnection/queue";
import { sweepDirectPayments, validatingCount } from "../direct-payments/validation";
import { releaseQueuedForCredit, sweepTopUps } from "../credit/topups";

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
  const released = await releaseQueuedForCredit(c.env);
  const report = await sweepDirectPayments(c.env);
  const topUps = await sweepTopUps(c.env);
  return c.json({ success: true, data: { ...report, released, topUps, validating: await validatingCount(c.env) } });
});

/* The journey e2e (tests/passkey/identity-journey.spec.ts) reads what
   the emails would carry: the last código for an address, and the last
   invitation id sent to one. Dev only, like everything here. */
dev.get("/last-code", async (c) => {
  const email = c.req.query("email") ?? "";
  const rows = await drizzle(c.env.DB).select().from(verification);
  const row = rows.filter((r) => r.identifier.includes(email)).at(-1);
  const code = row ? /\d{6}/.exec(row.value)?.[0] : undefined;
  return c.json({ success: true, data: { code: code ?? null } });
});

dev.get("/last-invitation", async (c) => {
  const email = c.req.query("email") ?? "";
  const rows = await drizzle(c.env.DB).select().from(invitation).where(eq(invitation.email, email));
  const row = rows.at(-1);
  return c.json({ success: true, data: { id: row?.id ?? null } });
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
      })
      .returning();
  }
  /* Idempotent, and the key refreshes: the demo business may have been
     seeded before the key existed in the environment. Actions enabled —
     the demo tenant is the backfill posture, not a new customer's ramp
     (integrations-hub D2/D4). */
  if (c.env.WISPHUB_API_KEY) {
    await upsertIntegration(db, business.id, {
      apiKey: c.env.WISPHUB_API_KEY,
      actionsEnabled: true,
    });
  }

  return c.json({
    success: true,
    data: {
      admin: { email: DEMO.ispEmail, password: DEMO.password },
    },
  });
});
