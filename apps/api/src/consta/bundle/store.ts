import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { cepBundles, cepRecords } from "../../db/schema";
import type { Bindings } from "../../env";
import { chunks, D1_MAX_PARAMS } from "../../db/params";
import { sha256Hex } from "../extraction";
import type { Owner } from "../index";
import { parseCadena } from "./cadena";
import { readCepPdf } from "./cep-pdf";
import type { BundleStatus, CadenaFacts, CepRecord } from "./types";
import { claveOfEntry, listEntries, readEntries, sniff } from "./zip";

/* cep-bundle-match D5, D16 — keeping what a search without a clave found.

   The engine writes two tables, under the business that received the
   money and never anyone else (constitution V): `cep_bundles`, one per
   several-matches answer, and `cep_records`, one per transfer, unique by
   business and clave. The platform's own top-ups write neither (D5): a
   record belongs to a business, and a top-up keeps today's path.

   D16 — the download. It is not a provider call: no credit, no
   `validations` row. It goes only to the provider's storage origin, a var
   (`APICEP_STORAGE_ORIGIN`) with no URL written in code (constitution
   VIII); unset, nothing is downloaded. A link on any other origin is never
   fetched — the bundle is `unreadable` and the payer is asked for the
   clave. No auth header (the measured links are public), a 10 s deadline
   and a 4 MB cap (~140 CEPs at 28 KB). A failed download leaves the bundle
   `pending` with its link, and the payment's next slot downloads again —
   never calls; the third failure is `unreadable`. */

export const DOWNLOAD_TIMEOUT_MS = 10_000;
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
export const MAX_DOWNLOAD_ATTEMPTS = 3;

export type StoredBundle = {
  id: string;
  status: BundleStatus;
  candidates: CepRecord[];
  unreadable: { entry: string; reason: string }[];
};

type Db = DrizzleD1Database;
type RecordRow = typeof cepRecords.$inferSelect;

export function recordOf(row: RecordRow): CepRecord {
  return {
    id: row.id,
    clave: row.clave,
    bundleId: row.bundleId,
    operationDate: row.operationDate,
    creditDate: row.creditDate,
    creditTime: row.creditTime,
    creditedAt: row.creditedAt.getTime(),
    senderBank: row.senderBank,
    senderAccountType: row.senderAccountType,
    senderAccount: row.senderAccount,
    receiverSpeiCode: row.receiverSpeiCode,
    receiverAccountType: row.receiverAccountType,
    receiverAccount: row.receiverAccount,
    amountCents: row.amountCents,
    certificateNumber: row.certificateNumber,
    seal: row.seal,
    sealStatus: row.sealStatus,
  };
}

/* The business's records for these claves, chunked under D1's cap */
export async function recordsFor(db: Db, businessId: string, claves: string[]): Promise<CepRecord[]> {
  const wanted = [...new Set(claves)];
  const rows: RecordRow[] = [];
  for (const part of chunks(wanted, D1_MAX_PARAMS - 1)) {
    rows.push(
      ...(await db
        .select()
        .from(cepRecords)
        .where(and(eq(cepRecords.businessId, businessId), inArray(cepRecords.clave, part)))),
    );
  }
  const byClave = new Map(rows.map((r) => [r.clave, recordOf(r)]));
  return wanted.flatMap((c) => (byClave.has(c) ? [byClave.get(c)!] : []));
}

/* ---- the download (D16) ---- */

type Download =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; retry: true; why: string }
  | { ok: false; retry: false; status: "unreadable" | "too_large"; why: string };

export function storageOrigin(env: Pick<Bindings, "APICEP_STORAGE_ORIGIN">): string | null {
  try {
    return env.APICEP_STORAGE_ORIGIN ? new URL(env.APICEP_STORAGE_ORIGIN).origin : null;
  } catch {
    return null;
  }
}

async function download(env: Pick<Bindings, "APICEP_STORAGE_ORIGIN">, url: string): Promise<Download> {
  const origin = storageOrigin(env);
  if (!origin) return { ok: false, retry: false, status: "unreadable", why: "no_storage_origin" };
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, retry: false, status: "unreadable", why: "bad_link" };
  }
  if (target.origin !== origin) return { ok: false, retry: false, status: "unreadable", why: "foreign_origin" };

  let res: Response;
  try {
    res = await fetch(target.toString(), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, retry: true, why: `network: ${String((e as Error)?.name ?? e)}` };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, retry: true, why: `http ${res.status}` };
  }
  const declared = Number(res.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_BUNDLE_BYTES) {
    await res.body?.cancel();
    return { ok: false, retry: false, status: "too_large", why: `declared ${declared} bytes` };
  }
  /* The cap holds on what is read, not only on what was declared */
  const reader = res.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BUNDLE_BYTES) {
        await reader.cancel();
        return { ok: false, retry: false, status: "too_large", why: `over ${MAX_BUNDLE_BYTES} bytes` };
      }
      parts.push(value);
    }
  } catch (e) {
    return { ok: false, retry: true, why: `read: ${String((e as Error)?.name ?? e)}` };
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  return { ok: true, bytes };
}

/* ---- reading a downloaded bundle ---- */

type Parsed = { claves: string[]; unreadable: { entry: string; reason: string }[]; kind: "zip" | "pdf" };

/* D3: a bundle's CEPs, read — pure but for `held`, which names the claves
   that need no reading (the business already holds their records): every
   entry's clave comes from its name, and only the others are inflated and
   read. Null when the bytes are neither a ZIP nor a PDF, or the ZIP will
   not open. The engine keeps what this reads (`readBundle`); `/dev/cep-read`
   shows it and keeps nothing — one reading, so the two never disagree. */
export type BundleReading = {
  kind: "zip" | "pdf";
  claves: string[];
  found: { clave: string; seal: string; facts: CadenaFacts }[];
  unreadable: { entry: string; reason: string }[];
};

export async function readBundleBytes(
  bytes: Uint8Array,
  held: (claves: string[]) => Promise<Set<string>> = async () => new Set(),
): Promise<BundleReading | null> {
  const kind = sniff(bytes);
  if (!kind) return null;
  const unreadable: { entry: string; reason: string }[] = [];
  const read: { clave: string; cadena: string; seal: string }[] = [];
  const claves: string[] = [];

  if (kind === "pdf") {
    /* A bundle of one, served bare: the clave is the one printed */
    const cep = readCepPdf(bytes);
    if ("unreadable" in cep) unreadable.push({ entry: "cep.pdf", reason: cep.unreadable });
    else {
      claves.push(cep.clave);
      read.push(cep);
    }
  } else {
    let names: string[];
    try {
      names = listEntries(bytes);
    } catch {
      return null;
    }
    const named = names.map((name) => ({ name, clave: claveOfEntry(name) }));
    for (const n of named) {
      if (n.clave) claves.push(n.clave);
      else unreadable.push({ entry: n.name, reason: "name" });
    }
    const skip = await held(claves);
    const wanted = new Map(named.filter((n) => n.clave && !skip.has(n.clave)).map((n) => [n.name, n.clave!]));
    let entries: { name: string; bytes: Uint8Array }[] = [];
    try {
      entries = readEntries(bytes, (name) => wanted.has(name));
    } catch {
      return null;
    }
    for (const e of entries) {
      const clave = wanted.get(e.name)!;
      const cep = readCepPdf(e.bytes, { expectedClave: clave });
      if ("unreadable" in cep) unreadable.push({ entry: e.name, reason: cep.unreadable });
      else read.push(cep);
    }
  }

  const found: BundleReading["found"] = [];
  for (const cep of read) {
    const facts = parseCadena(cep.cadena);
    if (!facts) unreadable.push({ entry: cep.clave, reason: "cadena" });
    else found.push({ clave: cep.clave, seal: cep.seal, facts });
  }
  return { kind, claves: [...new Set(claves)], found, unreadable };
}

/* D3, D5: the engine's reading, kept — each new CEP becomes a record of the
   business (first sighting wins the `bundle_id`) */
async function readBundle(db: Db, businessId: string, bundleId: string, bytes: Uint8Array): Promise<Parsed | null> {
  const reading = await readBundleBytes(bytes, async (claves) => new Set((await recordsFor(db, businessId, claves)).map((r) => r.clave)));
  if (!reading) return null;
  for (const cep of reading.found) {
    await db
      .insert(cepRecords)
      .values({ businessId, clave: cep.clave, bundleId, ...cep.facts, creditedAt: new Date(cep.facts.creditedAt), seal: cep.seal })
      .onConflictDoNothing();
  }
  return { claves: reading.claves, unreadable: reading.unreadable, kind: reading.kind };
}

/* Steps 2–5 of contracts/engine.md, for a file in hand */
async function settle(
  env: Bindings,
  db: Db,
  businessId: string,
  bundleId: string,
  bytes: Uint8Array,
  attempts: number,
): Promise<{ status: BundleStatus; candidates: CepRecord[]; unreadable: { entry: string; reason: string }[] }> {
  const parsed = await readBundle(db, businessId, bundleId, bytes);
  if (!parsed) {
    await db
      .update(cepBundles)
      .set({
        status: "unreadable",
        url: null,
        downloadAttempts: attempts,
        byteSize: bytes.byteLength,
        unreadable: JSON.stringify([{ entry: "", reason: "not_a_bundle" }]),
      })
      .where(and(eq(cepBundles.id, bundleId), eq(cepBundles.businessId, businessId)));
    return { status: "unreadable", candidates: [], unreadable: [{ entry: "", reason: "not_a_bundle" }] };
  }
  /* The file follows the receipts' retention: the bucket's 15-day rule
     (spec Assumptions); the records stay after it */
  const r2Key = `bundles/${businessId}/${bundleId}.${parsed.kind}`;
  await env.PROOFS.put(r2Key, bytes, {
    httpMetadata: { contentType: parsed.kind === "zip" ? "application/zip" : "application/pdf" },
  });
  await db
    .update(cepBundles)
    .set({
      status: "read",
      /* FR-010: the link never outlives the reading */
      url: null,
      downloadAttempts: attempts,
      claves: JSON.stringify(parsed.claves),
      unreadable: JSON.stringify(parsed.unreadable),
      sha256: await sha256Hex(bytes),
      r2Key,
      byteSize: bytes.byteLength,
      readAt: new Date(),
    })
    .where(and(eq(cepBundles.id, bundleId), eq(cepBundles.businessId, businessId)));
  return { status: "read", candidates: await recordsFor(db, businessId, parsed.claves), unreadable: parsed.unreadable };
}

async function attempt(env: Bindings, db: Db, businessId: string, bundleId: string, url: string, attempts: number): Promise<StoredBundle> {
  const got = await download(env, url);
  if (got.ok) return { id: bundleId, ...(await settle(env, db, businessId, bundleId, got.bytes, attempts)) };
  const scope = and(eq(cepBundles.id, bundleId), eq(cepBundles.businessId, businessId));
  if (got.retry && attempts < MAX_DOWNLOAD_ATTEMPTS) {
    console.error(`bundle ${bundleId}: download failed (${got.why}), attempt ${attempts}; the next slot tries again`);
    await db.update(cepBundles).set({ status: "pending", downloadAttempts: attempts }).where(scope);
    return { id: bundleId, status: "pending", candidates: [], unreadable: [] };
  }
  const status = got.retry ? "unreadable" : got.status;
  const unreadable = [{ entry: "", reason: got.why }];
  console.error(`bundle ${bundleId}: ${status} (${got.why})`);
  await db
    .update(cepBundles)
    .set({ status, downloadAttempts: attempts, url: null, unreadable: JSON.stringify(unreadable) })
    .where(scope);
  return { id: bundleId, status, candidates: [], unreadable };
}

/* A several-matches answer, for a business: the row, the download, the
   records. Null for the platform's own top-ups (D5) — nothing is
   downloaded and nothing written. */
export async function storeBundle(
  env: Bindings,
  db: Db,
  owner: Owner,
  input: {
    paymentRef: string | null;
    validationId: string | null;
    searchKeys: {
      referenceNumber?: string | null;
      transferDate?: string | null;
      senderBank?: string | null;
      amountCents?: number | null;
      beneficiary?: string | null;
    };
    url: string;
  },
): Promise<StoredBundle | null> {
  if (!("businessId" in owner)) return null;
  const [bundle] = await db
    .insert(cepBundles)
    .values({
      businessId: owner.businessId,
      paymentRef: input.paymentRef ?? "",
      validationId: input.validationId,
      source: "apicep",
      referenceNumber: input.searchKeys.referenceNumber ?? null,
      transferDate: input.searchKeys.transferDate ?? null,
      senderBank: input.searchKeys.senderBank ?? null,
      amountCents: input.searchKeys.amountCents ?? null,
      beneficiary: input.searchKeys.beneficiary ?? null,
      status: "pending",
      downloadAttempts: 0,
      url: input.url,
    })
    .returning({ id: cepBundles.id });
  return attempt(env, db, owner.businessId, bundle.id, input.url, 1);
}

/* D16 — the retry: the same steps with no provider call and no
   `validations` row. A bundle already read (or given up) answers with what
   it holds, so a retried slot can never download twice. */
export async function readPendingBundle(env: Bindings, db: Db, owner: Owner, bundleId: string): Promise<StoredBundle | null> {
  if (!("businessId" in owner)) return null;
  const [row] = await db
    .select()
    .from(cepBundles)
    .where(and(eq(cepBundles.id, bundleId), eq(cepBundles.businessId, owner.businessId)));
  if (!row) return null;
  if (row.status !== "pending" || !row.url) {
    const claves: string[] = row.claves ? JSON.parse(row.claves) : [];
    return {
      id: row.id,
      status: row.status,
      candidates: await recordsFor(db, owner.businessId, claves),
      unreadable: row.unreadable ? JSON.parse(row.unreadable) : [],
    };
  }
  return attempt(env, db, owner.businessId, row.id, row.url, row.downloadAttempts + 1);
}

/* D5, D9: the record of a single `valid`'s CEP, from its cadena — for a
   search that had no clave. Null for the platform, and when the cadena is
   not as measured (the lifecycle then treats the CEP as unreadable). The
   seal is `digitalSignature`, kept and not verified (D2); empty when the
   answer carried none. */
export async function storeSingleRecord(
  db: Db,
  owner: Owner,
  cep: { trackingKey: string | null; chain?: string | null; digitalSignature?: string | null },
): Promise<CepRecord | null> {
  if (!("businessId" in owner) || !cep.trackingKey) return null;
  const facts = parseCadena(cep.chain);
  if (!facts) return null;
  await db
    .insert(cepRecords)
    .values({
      businessId: owner.businessId,
      clave: cep.trackingKey,
      bundleId: null,
      ...facts,
      creditedAt: new Date(facts.creditedAt),
      seal: cep.digitalSignature ?? "",
    })
    .onConflictDoNothing();
  const [record] = await recordsFor(db, owner.businessId, [cep.trackingKey]);
  return record ?? null;
}
