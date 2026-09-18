import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { payments } from "../src/db/schema";
import { sweepReconnections } from "../src/reconnection/queue";
import { seedBusiness, seedConfirmedPayment } from "./helpers";

/* provider-address-per-isp US3 — two ISPs on two installations, at once.

   The interesting assertion here is the NEGATIVE one (research D8).
   "Business A reached origin A" is the weak half and passes with the
   bug present, because a missed call site sends A's traffic to whatever
   the platform binding names — which in this suite is origin A anyway.
   What catches it is proving origin B received nothing at all for A. */

const DEFAULT_ORIGIN = "https://api.wisphub.net";
const IO_ORIGIN = "https://api.wisphub.io";
const MINUTE = 60_000;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const db = () => drizzle(env.DB);
const reload = async (id: string) => (await db().select().from(payments).where(eq(payments.id, id)))[0];

type Tenant = {
  origin: string;
  usuario: string;
  wisphubId: string;
  invoiceId: number;
  /* every path this origin was actually asked for */
  seen: string[];
};

const customer = (usuario: string, wisphubId: string, estado: string) => ({
  id_servicio: Number(wisphubId),
  usuario,
  nombre: usuario,
  estado,
  estado_facturas: "Pendiente de Pago",
  precio_plan: "499.00",
  saldo: "0.00",
  zona: { id: 1, nombre: "Centro" },
});

/* One tenant's whole reconnection flow, on one origin. Every reply
   records the path it answered, so the test can say what each
   installation was asked for — and, more to the point, what it was
   not. */
function mockReconnection(tenant: Tenant) {
  const at = fetchMock.get(tenant.origin);
  const answer = (body: unknown) => (opts: { path: string }) => {
    tenant.seen.push(opts.path);
    return JSON.stringify(body);
  };
  const headers = { headers: { "Content-Type": "application/json" } };

  at.intercept({ method: "PATCH", path: `/api/clientes/${tenant.wisphubId}/` }).reply(
    200,
    answer({ id_servicio: Number(tenant.wisphubId), auto_activar_servicio: true }),
    headers,
  );
  at.intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).reply(
    200,
    answer({ results: [{ id: 7, nombre: "efectivo" }] }),
    headers,
  );
  at.intercept({
    method: "GET",
    path: (p) => p.startsWith("/api/facturas/?") && p.includes("estado=1"),
  }).reply(
    200,
    answer({
      count: 1,
      results: [{ id_factura: tenant.invoiceId, cliente: { usuario: tenant.usuario }, total: 499 }],
    }),
    headers,
  );
  at.intercept({ method: "POST", path: `/api/facturas/${tenant.invoiceId}/registrar-pago/` }).reply(
    200,
    answer({ messages: ["Se agrego correctamente el pago"], task_id: "t-1" }),
    headers,
  );
  at.intercept({
    method: "GET",
    path: (p) => p.startsWith("/api/clientes/") && p.includes("usuario="),
  }).reply(200, answer({ count: 1, results: [customer(tenant.usuario, tenant.wisphubId, "Activo")] }), headers);
}

/* An installation that cannot be reached at all. Only the two calls the
   attempt makes before it gives up need an answer — it fails at the
   payment-method read and never gets to an invoice. */
function mockUnreachable(origin: string, wisphubId: string) {
  const at = fetchMock.get(origin);
  at.intercept({ method: "PATCH", path: `/api/clientes/${wisphubId}/` }).replyWithError(
    new Error("connection refused"),
  );
  at.intercept({ method: "GET", path: (p) => p.startsWith("/api/formas-de-pago/") }).replyWithError(
    new Error("connection refused"),
  );
}

async function seedQueued(
  email: string,
  installation: string | null,
  customerFields: { usuario: string; wisphubId: string },
) {
  const business = await seedBusiness({
    email,
    wisphubApiKey: `key-${email}`,
    installation,
  });
  const charge = await seedConfirmedPayment(business, {
    wisphubCustomerId: customerFields.wisphubId,
    customerUsuario: customerFields.usuario,
    registeredCents: 49900,
    actionOutcome: "queued",
    actionAttempts: 1,
    nextAttemptAt: new Date(Date.now() - MINUTE),
  });
  return { business, charge };
}

describe("provider-address-per-isp US3: several ISPs on different installations at once", () => {
  it("each payment is registered on its own installation, and the other receives nothing for it", async () => {
    const onNet: Tenant = {
      origin: DEFAULT_ORIGIN,
      usuario: "ana@fastisp",
      wisphubId: "6",
      invoiceId: 601,
      seen: [],
    };
    const onIo: Tenant = {
      origin: IO_ORIGIN,
      usuario: "beto@pilotisp",
      wisphubId: "9",
      invoiceId: 902,
      seen: [],
    };

    /* One business on the platform default (installation null — every
       row that predates this feature), one on wisphub.io. */
    const net = await seedQueued("net@isp.mx", null, onNet);
    const io = await seedQueued("io@isp.mx", "wisphub_io", onIo);

    mockReconnection(onNet);
    mockReconnection(onIo);

    /* One sweep, both businesses, one batch — the code path where a
       missed call site would quietly send both to one host. */
    const report = await sweepReconnections(env);
    expect(report).toMatchObject({ claimed: 2, reconnected: 2, failed: 0 });

    expect((await reload(net.charge.id)).actionOutcome).toBe("done");
    expect((await reload(io.charge.id)).actionOutcome).toBe("done");

    /* Each registration landed on its own origin */
    expect(onNet.seen).toContain(`/api/facturas/${onNet.invoiceId}/registrar-pago/`);
    expect(onIo.seen).toContain(`/api/facturas/${onIo.invoiceId}/registrar-pago/`);

    /* THE assertion this file exists for: neither installation was
       asked for anything belonging to the other business. A missed
       `new WispHub(...)` shows up here and nowhere else. */
    for (const path of onNet.seen) {
      expect(path, `wisphub.net was asked for ${path}`).not.toContain(onIo.usuario);
      expect(path).not.toContain(String(onIo.invoiceId));
      expect(path).not.toBe(`/api/clientes/${onIo.wisphubId}/`);
    }
    for (const path of onIo.seen) {
      expect(path, `wisphub.io was asked for ${path}`).not.toContain(onNet.usuario);
      expect(path).not.toContain(String(onNet.invoiceId));
      expect(path).not.toBe(`/api/clientes/${onNet.wisphubId}/`);
    }
  });

  it("FR-012: one installation down queues only its own business's action, and the other collects normally", async () => {
    const healthy: Tenant = {
      origin: DEFAULT_ORIGIN,
      usuario: "ana@fastisp",
      wisphubId: "6",
      invoiceId: 601,
      seen: [],
    };
    const net = await seedQueued("net@isp.mx", null, healthy);
    const io = await seedQueued("io@isp.mx", "wisphub_io", {
      usuario: "beto@pilotisp",
      wisphubId: "9",
    });

    mockReconnection(healthy);
    mockUnreachable(IO_ORIGIN, "9");

    const report = await sweepReconnections(env);
    expect(report).toMatchObject({ claimed: 2, reconnected: 1 });

    /* The healthy tenant is untouched by the other's outage — this is
       the whole promise of moving the address onto the row. */
    expect((await reload(net.charge.id)).actionOutcome).toBe("done");

    /* And the unreachable one degrades the provider action ONLY: the
       payment keeps its money, its status and its place in the queue,
       with a visible reason and a next attempt (FR-012). */
    const stalled = await reload(io.charge.id);
    expect(stalled.actionOutcome).toBe("queued");
    expect(stalled.actionError).toBe("WISPHUB_UNAVAILABLE");
    expect(stalled.nextAttemptAt).not.toBeNull();
    expect(stalled.status).toBe("confirmed");
    expect(stalled.receivedCents).toBe(51400);
  });
});

/* The structural half of D4, and the reason the two above can be
   trusted: they prove the call sites that exist today are addressed
   correctly, and this proves no twelfth one can appear without
   somebody noticing. Constitution V asks that tenant isolation be
   "auditable with grep" — this IS that grep, run in CI. */
const SOURCES = import.meta.glob("../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("provider-address-per-isp US3: the factory is the only door", () => {
  it("reads the API's own source, so the assertion below is about real files", () => {
    /* A glob that matched nothing would make the next test pass while
       proving nothing at all. */
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES).some((p) => p.endsWith("wisphub/factory.ts"))).toBe(true);
  });

  it("no `new WispHub(` outside wisphub/factory.ts", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith("wisphub/factory.ts"))
      .filter(([, source]) => source.includes("new WispHub("))
      .map(([path]) => path);

    /* A client built anywhere else resolves its own address, and one
       that resolves it wrong registers a payment on another ISP's
       system. Route it through `wisphubFor(integration, env)` instead —
       the row it needs is already loaded at every existing call site. */
    expect(offenders).toEqual([]);
  });
});
