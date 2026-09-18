import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { integrationEvents, payments } from "../src/db/schema";
import { issueCredential } from "../src/api-clients/store";
import { seedBusiness } from "./helpers";
import {
  collectingCtx,
  db,
  mockApiCep,
  mockDestination,
  payerPost,
  registerWebhook,
  SPEI,
  testEnv,
  TRANSFER,
  v1,
  WISPHUB_ORIGIN,
} from "./collections-api-helpers";

/* automated-collections-api US2, scenario 9 / FR-029 (T040): a business
   with WispHub connected AND actions enabled pays an API link. The
   webhook is sent, and not one WispHub call is made — proven at the
   network edge: net connect is off, WispHub interceptors are armed for
   the calls the panel half would make, and they are still pending when
   the verdict has landed. `assertNoPendingInterceptors` then proves the
   only interceptor consumed was the webhook's. */

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const FEE = 1500;
const ASK = 49900;

describe("FR-029: the webhook is the outcome; WispHub is never touched", () => {
  it("an ISP with WispHub connected and actions enabled: the verdict lands, the webhook is delivered, and every WispHub interceptor stays untouched", async () => {
    const business = await seedBusiness({ ...SPEI, serviceFeeCents: FEE, wisphubApiKey: "wh-key-1", actionsEnabled: true });
    const { plaintext: key } = await issueCredential(db(), business.id, { name: "sistema" });
    await registerWebhook(key);
    const link = (await v1(key, "POST", "/payment-links", { customerRef: "CLI-9", askCents: ASK })).body.data!;

    /* Armed, never consumed: the panel half's customer read, its pending
       invoices, and the reconnection's PATCH */
    const wisphub = fetchMock.get(WISPHUB_ORIGIN);
    wisphub.intercept({ method: "GET", path: (p) => p.startsWith("/api/clientes") }).reply(200, "{}").persist();
    wisphub.intercept({ method: "GET", path: (p) => p.startsWith("/api/facturas") }).reply(200, "{}").persist();
    wisphub.intercept({ method: "PATCH", path: (p) => p.startsWith("/api/clientes") }).reply(200, "{}").persist();
    wisphub.intercept({ method: "POST", path: () => true }).reply(200, "{}").persist();

    const captured = mockDestination({ times: 2 });
    mockApiCep({ cep: { amountCents: ASK + FEE } });
    const { ctx, settled } = collectingCtx();
    const paid = await payerPost(String(link.url).split("/p/")[1], TRANSFER("TRACK000NOWH", ASK + FEE), testEnv, ctx);
    /* two-eyes-receipt D4: the answer does not wait for the provider —
       the verdict lands on the row once the deferred attempt settles,
       and the webhook pair below is what carries it outward */
    expect(paid.body.data).toMatchObject({ status: "validating" });
    await settled();

    expect(captured.map((c) => c.event.type).sort()).toEqual(["payment.confirmed", "payment.validating"]);
    const [row] = await db().select().from(payments).where(eq(payments.businessId, business.id));
    expect(row).toMatchObject({
      status: "confirmed",
      actionOutcome: "done",
      wisphubInvoiceId: null,
      paymentRegisteredAt: null,
      registeredCents: null,
      wisphubCustomerId: null,
      customerUsuario: null,
    });
    /* no dispatch decision was recorded either: the ledger is WispHub's */
    expect(await db().select().from(integrationEvents).where(eq(integrationEvents.businessId, business.id))).toHaveLength(0);

    /* every WispHub interceptor is still waiting — nothing reached it */
    const untouched = fetchMock.pendingInterceptors().filter((i) => i.origin === WISPHUB_ORIGIN);
    expect(untouched).toHaveLength(4);
    expect(untouched.every((i) => i.timesInvoked === 0)).toBe(true);
    wisphub.cleanMocks();
  });
});
