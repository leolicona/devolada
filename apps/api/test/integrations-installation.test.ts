import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { integrations } from "../src/db/schema";
import { app, seedBusiness, sessionCookieHeader } from "./helpers";

/* provider-address-per-isp US1 and US2 — the address the panel saves,
   and the four answers a connection test can give.

   Two origins are intercepted here (research D8). The pinned one is the
   platform default, exactly as `vitest.config.ts` fixes it; the second
   is the installation a business can now choose. The pin is not
   weakened by the second interceptor — the catalogue (D1) still bounds
   what any row can name, so no config and no row can send a call
   somewhere neither of these covers. */

const DEFAULT_ORIGIN = "https://api.wisphub.net";
const IO_ORIGIN = "https://api.wisphub.io";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

const asBusiness = { headers: { Cookie: await sessionCookieHeader("demo@devolada.app") } };

const send = (path: string, method: string, body?: unknown): [string, RequestInit] => [
  path,
  {
    method,
    headers: { "Content-Type": "application/json", ...asBusiness.headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  },
];

const oneCustomer = {
  results: [
    {
      id_servicio: 1,
      usuario: "greyes@wifiplus",
      nombre: "G. Reyes",
      estado: "Activo",
      estado_facturas: "Pagadas",
      precio_plan: "399.00",
      saldo: "0.00",
      zona: { nombre: "Centro" },
    },
  ],
};

/* One customer read, at the origin named. Every assertion about "which
   installation was called" is this interceptor being matched or not:
   `assertNoPendingInterceptors` in afterEach fails the test when the
   call landed somewhere else. */
function mockCustomers(origin: string, reply: { status: number; body?: unknown }) {
  fetchMock
    .get(origin)
    .intercept({ method: "GET", path: /\/api\/clientes\/.*/ })
    .reply(reply.status, JSON.stringify(reply.body ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
}

const db = () => drizzle(env.DB);

describe("provider-address-per-isp US1: an ISP connects on their own installation", () => {
  it("saves the installation beside the key and calls that installation, not the default", async () => {
    await seedBusiness();
    /* The proof is the ORIGIN: this interceptor is on wisphub.io, and
       nothing is registered on the default. A call to the default would
       fail netConnect, and an unused .io interceptor would fail the
       afterEach. */
    mockCustomers(IO_ORIGIN, { status: 200, body: oneCustomer });

    const res = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", {
        wisphubApiKey: "01q9K2Rf.SECRETKEY1234",
        installation: "wisphub_io",
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.wisphub.installation).toBe("wisphub_io");
    /* FR-004: what is being called, with the same prominence as the key */
    expect(data.wisphub.effectiveInstallation).toEqual({
      key: "wisphub_io",
      label: "wisphub.io",
      kind: "real",
      assumed: false,
    });
    /* FR-013: the key never travels back, installation or not */
    expect(JSON.stringify(data)).not.toContain("SECRETKEY");
    /* D1: a KEY is stored, never a URL — nothing resembling a host is
       written to the row */
    const [row] = await db().select().from(integrations);
    expect(row.installation).toBe("wisphub_io");
    expect(row.installation).not.toContain("http");
  });

  it("FR-002/SC-006: a row that chose nothing still reaches the pinned default, and says it was assumed", async () => {
    /* Exactly the shape of every business that existed before this
       feature: a key, no installation. Nothing about it changed. */
    await seedBusiness({ wisphubApiKey: "stored-key-0001" });
    /* All three probes, all on the PINNED origin: the connection test
       reads customers, invoices and payment methods (D7), and every one
       of them must still land where this suite has always pinned it. */
    mockCustomers(DEFAULT_ORIGIN, { status: 200, body: oneCustomer });
    mockInvoices(DEFAULT_ORIGIN, { status: 200, body: { results: [] } });
    mockPaymentMethods(DEFAULT_ORIGIN, { status: 200, body: { results: [{ id: 1, nombre: "Efectivo" }] } });

    const client = await app();
    const card = await client.request("/integrations", asBusiness, env);
    const { data } = await card.json();
    expect(data.wisphub.installation).toBeNull();
    expect(data.wisphub.effectiveInstallation).toEqual({
      key: "wisphub_net",
      label: "wisphub.net",
      kind: "real",
      /* the screen must be able to say "nobody picked this" */
      assumed: true,
    });

    /* And the provider call itself still lands on the pinned origin. */
    const test = await client.request(...send("/integrations/wisphub/test", "POST", {}), env);
    expect((await test.json()).data.ok).toBe(true);
  });

  it("FR-005: a value outside the catalogue is refused at the write path", async () => {
    await seedBusiness({ wisphubApiKey: "stored-key-0001" });
    const client = await app();

    for (const installation of ["wisphub_elsewhere", "https://evil.example/api", ""]) {
      const res = await client.request(
        ...send("/integrations/wisphub", "PATCH", { installation }),
        env,
      );
      expect(res.status, `${installation} must be refused`).toBe(400);
    }
    /* Nothing was written by any of them */
    const [row] = await db().select().from(integrations);
    expect(row.installation).toBeNull();
  });

  it("two businesses hold two installations, and neither reads the other's", async () => {
    await seedBusiness({ wisphubApiKey: "key-net-0001" });
    await seedBusiness({ email: "pilot@isp.mx", wisphubApiKey: "key-io-0002", installation: "wisphub_io" });

    const client = await app();
    const mine = await client.request("/integrations", asBusiness, env);
    expect((await mine.json()).data.wisphub.installation).toBeNull();

    const theirs = await client.request(
      "/integrations",
      { headers: { Cookie: await sessionCookieHeader("pilot@isp.mx") } },
      env,
    );
    expect((await theirs.json()).data.wisphub.installation).toBe("wisphub_io");
  });
});

/* provider-address-per-isp US2 — three failures that read as three
   different problems, and a success that does not claim more than it
   proved. */

const noInvoices = { results: [] };
const onePaymentMethod = { results: [{ id: 1, nombre: "Efectivo" }] };

function mockInvoices(origin: string, reply: { status: number; body?: unknown }) {
  fetchMock
    .get(origin)
    .intercept({ method: "GET", path: /\/api\/facturas\/.*/ })
    .reply(reply.status, JSON.stringify(reply.body ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
}

function mockPaymentMethods(origin: string, reply: { status: number; body?: unknown }) {
  fetchMock
    .get(origin)
    .intercept({ method: "GET", path: /\/api\/formas-de-pago\/.*/ })
    .reply(reply.status, JSON.stringify(reply.body ?? {}), {
      headers: { "Content-Type": "application/json" },
    });
}

/* FR-013 covers "no message **and no record**", and the adapter logs
   provider failures — so the key is hunted in the captured console as
   well as in the body (/speckit-analyze finding G2). */
function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };
  const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  console.debug = capture;
  return {
    lines,
    restore: () => Object.assign(console, original),
  };
}

const FIXTURE_KEY = "01q9K2Rf.SECRETKEY1234";

describe("provider-address-per-isp US2: a failed connection says which thing is wrong", () => {
  it("an unreachable installation is not the key's fault (INSTALLATION_UNREACHABLE)", async () => {
    await seedBusiness({ wisphubApiKey: FIXTURE_KEY, installation: "wisphub_io" });
    /* The host answers nothing usable. Nothing here is evidence about
       the credential, and the outcome must not pretend otherwise. */
    mockCustomers(IO_ORIGIN, { status: 503 });

    const res = await (await app()).request(...send("/integrations/wisphub/test", "POST", {}), env);
    const { data } = await res.json();
    expect(data.outcome).toBe("INSTALLATION_UNREACHABLE");
    expect(data.ok).toBe(false);
    expect(data.triedInstallation).toEqual({ key: "wisphub_io", label: "wisphub.io" });
    expect(data.verified).toEqual([]);
  });

  it("a refused key is refused by everything (KEY_REJECTED), and names the door knocked on", async () => {
    await seedBusiness({ wisphubApiKey: FIXTURE_KEY, installation: "wisphub_io" });
    mockCustomers(IO_ORIGIN, { status: 403 });

    const res = await (await app()).request(...send("/integrations/wisphub/test", "POST", {}), env);
    const { data } = await res.json();
    expect(data.outcome).toBe("KEY_REJECTED");
    /* FR-010: the installation tried travels with the verdict, because
       "your key is wrong" and "you are on the wrong WispHub" look
       identical from the provider and are opposite problems. */
    expect(data.triedInstallation).toEqual({ key: "wisphub_io", label: "wisphub.io" });
    expect(data.verified).toEqual([]);
    expect(data.missingPermission).toBeNull();
  });

  it("a permission refused AFTER a read passed is a permission, not a bad key (PERMISSION_MISSING)", async () => {
    await seedBusiness({ wisphubApiKey: FIXTURE_KEY });
    /* The same generic 403 the provider sends for a bad key — what
       tells them apart is that customers already answered. */
    mockCustomers(DEFAULT_ORIGIN, { status: 200, body: oneCustomer });
    mockInvoices(DEFAULT_ORIGIN, { status: 403 });

    const res = await (await app()).request(...send("/integrations/wisphub/test", "POST", {}), env);
    const { data } = await res.json();
    expect(data.outcome).toBe("PERMISSION_MISSING");
    expect(data.ok).toBe(false);
    expect(data.verified).toEqual(["customers"]);
    expect(data.missingPermission).toBe("invoices");
    expect(data.triedInstallation).toEqual({ key: "wisphub_net", label: "wisphub.net" });
  });

  it("OK carries the three reads as verified and the four writes as NOT (FR-011 as amended, D7)", async () => {
    await seedBusiness({ wisphubApiKey: FIXTURE_KEY });
    mockCustomers(DEFAULT_ORIGIN, { status: 200, body: oneCustomer });
    mockInvoices(DEFAULT_ORIGIN, { status: 200, body: noInvoices });
    mockPaymentMethods(DEFAULT_ORIGIN, { status: 200, body: onePaymentMethod });

    const res = await (await app()).request(...send("/integrations/wisphub/test", "POST", {}), env);
    const { data } = await res.json();
    expect(data.outcome).toBe("OK");
    expect(data.ok).toBe(true);
    expect(data.verified).toEqual(["customers", "invoices", "payment_methods"]);
    /* The honest half: a write is never proven here, because proving it
       means writing into a real ISP's live billing. A green connection
       that listed nothing unverified would be the old silent claim. */
    expect(data.unverified).toEqual([
      "create_invoice",
      "register_payment",
      "auto_activate",
      "payment_promise",
    ]);
    expect(data.sampleCustomerCount).toBe(1);
  });

  it("FR-013: the key is in no response body and in no log line, on every outcome", async () => {
    await seedBusiness({ wisphubApiKey: FIXTURE_KEY, installation: "wisphub_io" });
    const client = await app();
    const captured = captureLogs();
    const bodies: string[] = [];
    try {
      /* unreachable, rejected, permission-missing, ok — the four in turn */
      mockCustomers(IO_ORIGIN, { status: 503 });
      bodies.push(await (await client.request(...send("/integrations/wisphub/test", "POST", {}), env)).text());

      mockCustomers(IO_ORIGIN, { status: 403 });
      bodies.push(await (await client.request(...send("/integrations/wisphub/test", "POST", {}), env)).text());

      mockCustomers(IO_ORIGIN, { status: 200, body: oneCustomer });
      mockInvoices(IO_ORIGIN, { status: 403 });
      bodies.push(await (await client.request(...send("/integrations/wisphub/test", "POST", {}), env)).text());

      mockCustomers(IO_ORIGIN, { status: 200, body: oneCustomer });
      mockInvoices(IO_ORIGIN, { status: 200, body: noInvoices });
      mockPaymentMethods(IO_ORIGIN, { status: 200, body: onePaymentMethod });
      bodies.push(await (await client.request(...send("/integrations/wisphub/test", "POST", {}), env)).text());
    } finally {
      captured.restore();
    }

    for (const body of bodies) {
      expect(body).not.toContain("SECRETKEY");
      expect(body).not.toContain(FIXTURE_KEY);
    }
    for (const line of captured.lines) {
      expect(line).not.toContain("SECRETKEY");
      expect(line).not.toContain(FIXTURE_KEY);
    }
  });

  it("FR-009: saving only the installation re-tests against the new one, and the save is not blocked by the answer", async () => {
    await seedBusiness({ wisphubApiKey: "stored-key-0001" });
    /* The stored installation is null (wisphub.net). The patch names
       wisphub.io, so THAT is the door the test must knock on — and it
       refuses, which must still not stop the save. */
    mockCustomers(IO_ORIGIN, { status: 403 });

    const res = await (await app()).request(
      ...send("/integrations/wisphub", "PATCH", { installation: "wisphub_io" }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.wisphubTest.outcome).toBe("KEY_REJECTED");
    expect(data.wisphubTest.triedInstallation).toEqual({ key: "wisphub_io", label: "wisphub.io" });
    /* settings D3 still holds: the result is reported, never enforced */
    expect(data.wisphub.installation).toBe("wisphub_io");
    expect(data.wisphub.keyTail).toBe("0001");
    const [row] = await db().select().from(integrations);
    expect(row.installation).toBe("wisphub_io");
    expect(row.apiKey).toBe("stored-key-0001");
  });

  it("T045: the test knocks on the installation the panel named, not the stored one", async () => {
    /* An ISP who picked wrong and was rejected: the row still holds the
       old address (null — the platform default), and the picker on
       screen holds the new one. Testing the row would answer about the
       door they are walking away from, which is the wrong answer
       FR-010 exists to stop giving. */
    await seedBusiness({ wisphubApiKey: "stored-key-0001" });
    mockCustomers(IO_ORIGIN, { status: 403 });

    const res = await (await app()).request(
      ...send("/integrations/wisphub/test", "POST", { installation: "wisphub_io" }),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();

    /* The origin is the proof: the interceptor is on wisphub.io and a
       call to the pinned default would fail netConnect. */
    expect(data.triedInstallation).toEqual({ key: "wisphub_io", label: "wisphub.io" });
    expect(data.outcome).toBe("KEY_REJECTED");
    /* A test writes nothing — naming an installation is not choosing
       it. Only a PATCH stores one. */
    const [row] = await db().select().from(integrations);
    expect(row.installation).toBeNull();
  });

  it("with no key at all no test ran, and the answer says exactly that", async () => {
    await seedBusiness();
    const res = await (await app()).request(...send("/integrations/wisphub/test", "POST", {}), env);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: { code: "WISPHUB_NOT_CONFIGURED" } });
  });
});
