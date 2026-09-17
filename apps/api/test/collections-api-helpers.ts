import { expect } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { issueCredential } from "../src/api-clients/store";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";
import type { Jwks, WebhookEvent } from "../src/routes/v1/schema";
import { webhookEvent } from "../src/routes/v1/schema";

/* Shared by every `collections-api-*` suite (automated-collections-api
   US1–US4): a business with a credential, a `/v1` request with the
   bearer, the provider mocked at its real origin, and the one assertion
   every suite repeats — nothing on this surface speaks ISP (T024). */

export const APICEP_ORIGIN = "https://api.apicep.cloud";
export const WISPHUB_ORIGIN = "https://api.wisphub.net";

export const SPEI = {
  speiClabe: "646180157000000004",
  speiBank: "STP",
  speiBeneficiaryName: "Gimnasio Norte SA de CV",
};

/* The provider credential and origin come pinned from vitest.config.ts
   (constitution IV); the proof bucket is the in-memory double. */
export const testEnv = { ...env, PROOFS: fakeProofs() } as typeof env & Bindings;
export const withoutToken = { ...testEnv, APICEP_TOKEN: undefined } as typeof env & Bindings;

export const db = () => drizzle(env.DB);

/* A configured business with NO integration row — the gym of research
   D5 — and one live credential. `wisphubApiKey` seeds an ISP instead. */
export async function seedApiBusiness(
  overrides: Parameters<typeof seedBusiness>[0] = {},
  credential: { name?: string; isTest?: boolean } = {},
) {
  const business = await seedBusiness({ ...SPEI, ...overrides });
  const issued = await issueCredential(db(), business.id, {
    name: credential.name ?? "sistema",
    isTest: credential.isTest ?? false,
  });
  return { business, key: issued.plaintext, credential: issued.credential };
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/* One /v1 call: bearer, JSON body, optional extra headers */
export async function v1(
  key: string,
  method: Method,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  bindings: typeof env & Bindings = testEnv,
) {
  const res = await (await app()).request(
    `/v1${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    bindings,
  );
  const json = (await res.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; retryable: boolean; message?: string };
  };
  expectNoIspVocabulary(json);
  return { status: res.status, body: json, headers: res.headers };
}

/* The payer's page, for the link the API handed out */
export async function payerGet(token: string, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(`/direct-payments/links/${token}`, {}, bindings);
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string } } };
}

/* automated-collections-api D8 (FR-017): the first webhook attempt runs
   under `ctx.waitUntil`, past the payer's answer. A test hands the app a
   context that collects that work and awaits it explicitly — so the
   inline path is proven, and nothing floats across test boundaries.
   Without one, `deferOf` finds no context and the sweep is the path. */
export function collectingCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work);
    },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    settled: async () => {
      /* work may enqueue more work while awaited */
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}

export async function payerPost(
  token: string,
  body: unknown,
  bindings: typeof env & Bindings = testEnv,
  ctx?: ExecutionContext,
) {
  const res = await (await app()).request(
    `/direct-payments/links/${token}/pay`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    bindings,
    ctx,
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string } } };
}

/* The receipt door: a PNG lands in the proof bucket, and the submission
   names it (direct-payment D12) */
export async function payerUploadProof(token: string, bindings: typeof env & Bindings = testEnv): Promise<string> {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(1024)], "cep.png", { type: "image/png" }));
  const res = await (await app()).request(`/direct-payments/links/${token}/proof`, { method: "POST", body: form }, bindings);
  const json = (await res.json()) as { data: { proofId: string } };
  return json.data.proofId;
}

export async function payerStatus(paymentId: string, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(`/direct-payments/${paymentId}/status`, {}, bindings);
  return (await res.json()) as { data: Record<string, unknown> };
}

/* ---- the webhook destination (automated-collections-api US2) ---- */

/* Pinned in vitest.config.ts (D8): every suite registers this one address
   and intercepts it at its origin, exactly as the providers are. */
export const DESTINATION_URL = env.WEBHOOK_TEST_DESTINATION_URL;
export const DESTINATION_ORIGIN = new URL(DESTINATION_URL).origin;
const DESTINATION_PATH = new URL(DESTINATION_URL).pathname;

export type CapturedDelivery = {
  headers: Record<string, string>;
  body: string;
  event: WebhookEvent;
};

function headersOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i]).toLowerCase()] = String(raw[i + 1]);
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) out[key.toLowerCase()] = String(value);
  return out;
}

function bodyOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw));
  return String(raw ?? "");
}

/* Intercept `times` POSTs to the destination, answering `status`, and
   capture what each carried. `delayMs` makes the endpoint hang — the
   FR-016 timeout is what a test of it shrinks (WEBHOOK_DELIVERY_TIMEOUT_MS). */
export function mockDestination(opts: { status?: number; times?: number; delayMs?: number } = {}): CapturedDelivery[] {
  const captured: CapturedDelivery[] = [];
  let lastBody = "";
  const scope = fetchMock
    .get(DESTINATION_ORIGIN)
    .intercept({
      method: "POST",
      path: DESTINATION_PATH,
      body: (raw) => {
        lastBody = bodyOf(raw);
        return true;
      },
    })
    .reply((request) => {
      const body = lastBody || bodyOf(request.body);
      const parsed = webhookEvent.safeParse(JSON.parse(body));
      if (!parsed.success) throw new Error(`webhook body is off the contract: ${parsed.error.message}`);
      expectNoIspVocabulary(parsed.data);
      captured.push({ headers: headersOf(request.headers), body, event: parsed.data });
      return { statusCode: opts.status ?? 200, data: "" };
    })
    .times(opts.times ?? 1);
  if (opts.delayMs) scope.delay(opts.delayMs);
  return captured;
}

export async function registerWebhook(key: string, url: string = DESTINATION_URL) {
  return v1(key, "PUT", "/webhook", { url });
}

export async function jwksOf(bindings: typeof env & Bindings = testEnv): Promise<{ status: number; headers: Headers; body: Jwks }> {
  const res = await (await app()).request("/.well-known/jwks.json", {}, bindings);
  return { status: res.status, headers: res.headers, body: (await res.json()) as Jwks };
}

/* What a caller does with a delivery (contracts/public-api.md): pick the
   key the header names from the published set, and verify ES256 over
   `"<timestamp>.<raw body>"` before parsing anything. Holds nothing but
   the JWKS — the point of D10. */
export async function verifyDelivery(jwks: Jwks, delivery: CapturedDelivery): Promise<boolean> {
  const kid = delivery.headers["devolada-key-id"];
  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) return false;
  const signature = delivery.headers["devolada-signature"] ?? "";
  if (!signature.startsWith("v1=")) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const raw = atob(signature.slice(3).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil((signature.length - 3) / 4) * 4, "="));
  const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    bytes,
    new TextEncoder().encode(`${delivery.headers["devolada-timestamp"]}.${delivery.body}`),
  );
}

/* T024 / SC-011 / FR-028: no request, answer, error or webhook body on
   this surface names a subscriber, a service, a router or WispHub. The
   whole JSON is scanned — keys and values alike — so a field named after
   an ISP concept fails the same as a message that mentions one. */
const ISP_VOCABULARY = /usuario|servicio|wisphub|subscriber|suscriptor|router|internet/i;

export function expectNoIspVocabulary(payload: unknown): void {
  const text = JSON.stringify(payload) ?? "";
  const hit = ISP_VOCABULARY.exec(text);
  expect(hit, `ISP vocabulary "${hit?.[0]}" reached the API surface: ${text.slice(0, 200)}`).toBeNull();
}

const json = (body: unknown) =>
  [200, JSON.stringify(body), { headers: { "Content-Type": "application/json" } }] as const;

export const DEFAULT_CEP = {
  trackingKey: "TRACK001XYZ",
  amountCents: 51400,
  date: new Date().toISOString().slice(0, 10),
  senderBank: "NUBANK",
  senderName: "ANA RUIZ",
  receiverBank: "STP",
  beneficiaryName: "Gimnasio Norte SA de CV",
};

/* apiCEP's wire for a verdict (the same mapping the direct-payment suite
   keeps: `valid` → LIQUIDADO with details; `pending`; `invalid` with
   nothing behind it is not_found). Amounts cross as decimal pesos and the
   engine turns them back into cents (validation spec D7). */
export function mockApiCep(
  data: {
    status?: "valid" | "pending" | "invalid";
    cep?: Partial<typeof DEFAULT_CEP>;
    /* an `invalid` WITH a cepStatus is evidence — `contradicted`; without
       one it is `not_found` and rides the schedule */
    cepStatus?: string;
  } = {},
) {
  const status = data.status ?? "valid";
  const cep = { ...DEFAULT_CEP, ...(data.cep ?? {}) };
  const captured: { body?: Record<string, unknown> } = {};
  fetchMock
    .get(APICEP_ORIGIN)
    .intercept({
      method: "POST",
      path: "/validate-transfer",
      body: (raw) => {
        captured.body = JSON.parse(String(raw));
        return true;
      },
    })
    .reply(
      ...json({
        validationId: "v-1",
        status,
        validation: {
          banxicoConfirmed: status === "valid",
          cepPreviouslyValidated: false,
          ...(status === "valid"
            ? {
                cepStatus: "LIQUIDADO",
                cepDetails: {
                  trackingKey: cep.trackingKey,
                  amount: cep.amountCents / 100,
                  operationDate: cep.date,
                  senderBank: cep.senderBank,
                  senderName: cep.senderName,
                  receiverBank: cep.receiverBank,
                  beneficiaryName: cep.beneficiaryName,
                },
              }
            : data.cepStatus
              ? { cepStatus: data.cepStatus }
              : {}),
        },
      }),
    );
  return captured;
}

export const TRANSFER = (trackingKey = "TRACK001XYZ", amountCents?: number) => ({
  transfer: {
    trackingKey,
    senderBank: "NUBANK",
    date: new Date().toISOString().slice(0, 10),
    ...(amountCents !== undefined ? { amountCents } : {}),
  },
});
