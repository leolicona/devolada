import type { Context } from "hono";
import type { Defer } from "../webhooks/queue";

/* automated-collections-api D8 (FR-017): work a handler hands past its
   own return — the first webhook attempt at a verdict, a re-send the
   caller asked for. In a Worker that is `ctx.waitUntil`; the Hono
   context throws when it has none (a test calling `app.request` without
   one), and then the work is simply left to the sweep, which is due the
   same minute. Never awaited in the handler's own path: the payer's
   verdict must not wait on the business's endpoint. */
export function deferOf(c: Pick<Context, "executionCtx">): Defer | undefined {
  try {
    const ctx = c.executionCtx;
    return (work) => ctx.waitUntil(work);
  } catch {
    return undefined;
  }
}
