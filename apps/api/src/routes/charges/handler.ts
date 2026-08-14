import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Bindings, Variables } from "../../env";
import { isps, stores } from "../../db/schema";
import { storeBalanceCents } from "../../ledger";
import { WispHub, WispHubError } from "../../wisphub/client";
import type { CustomerQuoteResponse, CustomerSearchResponse } from "./schema";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/* Shared guard: store actor + its ISP with a working key, or an error response. */
async function storeContext(c: Ctx) {
  const actor = c.get("actor");
  if (actor.type !== "store") {
    return { error: c.json({ success: false, error: { code: "AUTHENTICATION_ERROR" } }, 403) };
  }
  const db = drizzle(c.env.DB);
  const [isp] = await db.select().from(isps).where(eq(isps.id, actor.ispId));
  if (!isp?.wisphubApiKey) {
    return { error: c.json({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } }, 503) };
  }
  return { actor, isp, db, wisphub: new WispHub(isp.wisphubApiKey) };
}

function wisphubFailure(c: Ctx, e: unknown) {
  if (e instanceof WispHubError) {
    /* D3: a rejected key surfaces as a setup problem, like a missing key */
    const code = e.code === "WISPHUB_AUTH_FAILED" ? "WISPHUB_NOT_CONFIGURED" : e.code;
    return c.json({ success: false, error: { code } }, 503);
  }
  throw e;
}

export async function searchCustomers(c: Ctx, q: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  try {
    const customers = await ctx.wisphub.searchCustomers(q);
    const data: CustomerSearchResponse = { customers };
    return c.json({ success: true, data });
  } catch (e) {
    return wisphubFailure(c, e);
  }
}

/* The quote for the confirm screen (charge-confirm spec D2):
   customer + server-computed breakdown + balance-cap state. */
export async function getCustomerQuote(c: Ctx, usuario: string) {
  const ctx = await storeContext(c);
  if ("error" in ctx) return ctx.error;

  try {
    const customer = await ctx.wisphub.getCustomer(usuario);
    if (!customer) {
      return c.json({ success: false, error: { code: "CUSTOMER_NOT_FOUND" } }, 404);
    }

    const [store] = await ctx.db.select().from(stores).where(eq(stores.id, ctx.actor.id));
    const serviceFeeCents = ctx.isp.serviceFeeCents;
    const balanceCents = await storeBalanceCents(ctx.db, ctx.actor.id);
    const capCents = store.balanceCapCents;

    const data: CustomerQuoteResponse = {
      customer,
      quote: {
        monthlyFeeCents: customer.monthlyFeeCents,
        serviceFeeCents,
        totalCents: customer.monthlyFeeCents + serviceFeeCents,
      },
      cap: { balanceCents, capCents, blocked: balanceCents >= capCents },
    };
    return c.json({ success: true, data });
  } catch (e) {
    return wisphubFailure(c, e);
  }
}
