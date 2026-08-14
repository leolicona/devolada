import type { Context } from "hono";
import { and, desc, eq, inArray, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { invitations, isps, ledgerEntries, stores } from "../../db/schema";
import { AgnosticAuth } from "../../auth/agnostic";
import { ledgerPageForStore } from "../ledger/handler";
import type { StoreItem } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

const APPROACHING_RATIO = 0.8;

function ispGuard(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "isp") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  return { actor, db: drizzle(c.env.DB) };
}

function toItem(
  store: typeof stores.$inferSelect,
  balanceCents: number,
  invitationStatus: "sent" | "accepted" | null,
): StoreItem {
  return {
    id: store.id,
    name: store.name,
    contactName: store.contactName,
    phone: store.phone,
    zone: store.zone,
    status: store.status,
    invitationStatus,
    commissionCents: store.commissionCents,
    balanceCents,
    cap: {
      capCents: store.balanceCapCents,
      approaching: balanceCents >= store.balanceCapCents * APPROACHING_RATIO,
      blocked: balanceCents >= store.balanceCapCents,
    },
  };
}

const invitationLinkFor = (env: Bindings, token: string) =>
  `${env.TIENDA_BASE_URL}/invitation/${token}`;

/* D4: balances arrive with the list, one grouped query */
export async function listStores(c: Ctx) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  const rows = await ctx.db.select().from(stores).where(eq(stores.ispId, ctx.actor.id));
  const ids = rows.map((s) => s.id);
  const balances = ids.length
    ? await ctx.db
        .select({ storeId: ledgerEntries.storeId, total: sum(ledgerEntries.cents) })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.storeId, ids))
        .groupBy(ledgerEntries.storeId)
    : [];
  const balanceById = new Map(balances.map((b) => [b.storeId, Number(b.total ?? 0)]));
  const invites = ids.length
    ? await ctx.db.select().from(invitations).where(inArray(invitations.storeId, ids))
    : [];
  const inviteById = new Map(invites.map((i) => [i.storeId, i.status]));

  return c.json({
    success: true,
    data: {
      stores: rows.map((s) =>
        toItem(s, balanceById.get(s.id) ?? 0, inviteById.get(s.id) ?? null),
      ),
    },
  });
}

export async function createStore(
  c: Ctx,
  body: {
    name: string;
    contactName: string;
    phone: string;
    zone?: string;
    commissionCents?: number | null;
    balanceCapCents?: number;
  },
) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;

  /* D1: verification gates operation (isp-signup D3, enforced here) */
  const [isp] = await ctx.db.select().from(isps).where(eq(isps.id, ctx.actor.id));
  if (!isp.emailVerified) {
    return c.json({ success: false, error: { code: "EMAIL_NOT_VERIFIED" } }, 403);
  }

  const [taken] = await ctx.db.select().from(stores).where(eq(stores.phone, body.phone));
  if (taken) return c.json({ success: false, error: { code: "PHONE_TAKEN" } }, 409);

  const [store] = await ctx.db
    .insert(stores)
    .values({
      ispId: ctx.actor.id,
      name: body.name,
      contactName: body.contactName,
      phone: body.phone,
      zone: body.zone ?? null,
      commissionCents: body.commissionCents ?? null,
      ...(body.balanceCapCents ? { balanceCapCents: body.balanceCapCents } : {}),
    })
    .returning();

  const { token } = await new AgnosticAuth(c.env).initiate(body.phone);
  await ctx.db.insert(invitations).values({ storeId: store.id, token });

  return c.json(
    {
      success: true,
      data: {
        store: toItem(store, 0, "sent"),
        /* D2: the copyable link is the product until TD-003 is paid */
        invitationLink: invitationLinkFor(c.env, token),
      },
    },
    201,
  );
}

async function ownStore(ctx: { actor: { id: string }; db: ReturnType<typeof drizzle> }, id: string) {
  const [store] = await ctx.db.select().from(stores).where(eq(stores.id, id));
  if (!store || store.ispId !== ctx.actor.id) return null;
  return store;
}

export async function getStore(c: Ctx, id: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const store = await ownStore(ctx, id);
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);

  const [b] = await ctx.db
    .select({ total: sum(ledgerEntries.cents) })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.storeId, store.id));
  const [invite] = await ctx.db
    .select()
    .from(invitations)
    .where(eq(invitations.storeId, store.id))
    .orderBy(desc(invitations.createdAt))
    .limit(1);

  return c.json({
    success: true,
    data: toItem(store, Number(b?.total ?? 0), invite?.status ?? null),
  });
}

export async function patchStore(
  c: Ctx,
  id: string,
  body: { commissionCents?: number | null; balanceCapCents?: number; status?: "active" | "suspended" },
) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const store = await ownStore(ctx, id);
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);

  await ctx.db
    .update(stores)
    .set({
      ...(body.commissionCents !== undefined ? { commissionCents: body.commissionCents } : {}),
      ...(body.balanceCapCents !== undefined ? { balanceCapCents: body.balanceCapCents } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    .where(eq(stores.id, store.id));
  return getStore(c, id);
}

/* D3: re-send rotates the token in place */
export async function resendInvitation(c: Ctx, id: string) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const store = await ownStore(ctx, id);
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);

  const [invite] = await ctx.db
    .select()
    .from(invitations)
    .where(and(eq(invitations.storeId, store.id), eq(invitations.status, "sent")));
  if (!invite) return c.json({ success: false, error: { code: "ALREADY_ACCEPTED" } }, 409);

  const { token } = await new AgnosticAuth(c.env).initiate(store.phone);
  await ctx.db.update(invitations).set({ token }).where(eq(invitations.id, invite.id));
  return c.json({ success: true, data: { invitationLink: invitationLinkFor(c.env, token) } });
}

export async function getStoreLedger(c: Ctx, id: string, cursor?: number) {
  const ctx = ispGuard(c);
  if ("error" in ctx) return ctx.error;
  const store = await ownStore(ctx, id);
  if (!store) return c.json({ success: false, error: { code: "NOT_FOUND" } }, 404);
  const data = await ledgerPageForStore(ctx.db, store.id, cursor);
  return c.json({ success: true, data });
}
