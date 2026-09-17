import { expect } from "vitest";
import { env, fetchMock } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { issueCredential } from "../src/api-clients/store";
import type { Bindings } from "../src/env";
import { app, fakeProofs, seedBusiness } from "./helpers";

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

export async function payerPost(token: string, body: unknown, bindings: typeof env & Bindings = testEnv) {
  const res = await (await app()).request(
    `/direct-payments/links/${token}/pay`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    bindings,
  );
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: { code: string } } };
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
export function mockApiCep(data: { status?: "valid" | "pending" | "invalid"; cep?: Partial<typeof DEFAULT_CEP> } = {}) {
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
