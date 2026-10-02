#!/usr/bin/env node
/* Local apiCEP stand-in (validation spec, "Local sandbox").
   apiCEP has no sandbox of its own (docs checked 2026-08-17), so this
   little server plays its part for manual dev: point the API's
   APICEP_BASE_URL at it and no request ever leaves the machine or spends
   a credit. It moved here with the engine (consta-api-merge D1): Consta
   is a module of the API now, so `pnpm --filter @devolada/api sandbox`
   is the whole local setup, beside `dev`.

   The trackingKey picks the scenario:
     contains "PEND"  → invalid + cepStatus EN PROCESO (Consta must say pending)
     contains "DUP"   → valid, cepPreviouslyValidated true (replay flag)
     contains "BAD"   → invalid, cepStatus DEVUELTO (Consta: reason contradicted)
     contains "NF"    → invalid, no cepStatus and no cepDetails (reason not_found)
     contains "E500"  → HTTP 500 (Consta: PROVIDER_UNAVAILABLE, retryable)
     contains "R429"  → HTTP 429 + X-RateLimit-Reset (PROVIDER_RATE_LIMITED)
     contains "A401T" → HTTP 401, the transient body (PROVIDER_UNAVAILABLE)
     contains "A401"  → HTTP 401, revoked token (PROVIDER_AUTH_FAILED)
     contains "B400"  → bare 400, no envelope (REQUEST_REJECTED)
     contains "E400"  → envelope-shaped 400 with a validationId (REQUEST_REJECTED,
                        and the id must land in the log — D15, scenario 12)
     contains "D422"  → HTTP 422, duplicated reference (REQUEST_REJECTED +
                        hint provide_tracking_key)
     contains "UNK"   → 200 with an unrecognised status (must never read as invalid)
     contains "HANG"  → no answer, ever (Consta's own deadline must fire — D16)
     contains "ERR"   → HTTP 503 (PROVIDER_UNAVAILABLE)
     anything else    → valid, LIQUIDADO, echoing the claimed data
   receipt-triage D1/D17: a direct-mode body may carry `sender.referenceNumber`
   and no trackingKey. Then the reference picks the scenario:
     "9999999"        → HTTP 422, "referencia duplicada en Banxico (requiere
                        clave de rastreo)" (REQUEST_REJECTED + hint
                        provide_tracking_key — the caller asks for the clave)
     "4417000"        → cep-bundle-match D1: the shared reference. The
                        several-matches answer as measured 2026-09-26 —
                        `invalid`, `banxicoConfirmed: true`, no cepDetails,
                        no cepStatus — with `downloads.cepPdf` linking
                        `/mock-bundle.zip?day=<the day asked>`: a ZIP served
                        as `application/pdf`, two synthetic CEPs of $3.00 to
                        the dev seed's CLABE, tails 8301 (credited 07:11:20)
                        and 4417 (11:40:47), built by `cep-bundle.mjs`. Point
                        APICEP_STORAGE_ORIGIN at this server too, or the API
                        never downloads it (D16)
     payment-without-receipt T008 — a payer's own reference (seven
     digits, first 1–9) picks by what it ends in:
       "…11"          → valid on the day asked, from tail 8301, credited
                        07:11:20, with its cdaChain (the account is learned)
       "…22"          → valid only on the day BEFORE the first day asked
                        for that reference: not found at the confirmation,
                        found by the neighbouring-days round (D14)
       "…33"          → several: two CEPs from one account (tail 8301),
                        credited 07:11 and 07:13 — the earliest confirms
       "…44"          → several: two CEPs from two accounts, tails 8301
                        and 4417, claves ending …0412 and …977I — a learned
                        account, or one answer to the tie-break, picks
                        (confirmation-hierarchy quickstart: `9771` must fit
                        …977I, O read as 0 and I as 1)
       "…55"          → several: two CEPs from two accounts, tails 8301 and
                        4417, claves that share their last four (…5510) —
                        the characters leave both, the digits decide
       "…66"          → one CEP, tail 8301, clave ending …3O10 — a single
                        match on a typed reference is asked too (FR-009);
                        `3010` must fit it
       any other seven digits → not found (the ladder: check the data, then
                        the clave)
     anything else    → valid, LIQUIDADO, with Banxico's clave in
                        `cepDetails.trackingKey` (the caller adopts it — D14)
                        and the beneficiary's account in
                        `cepDetails.beneficiaryAccount` (D22)
   receipt-triage D9: `beneficiary.cardNumber` and `beneficiary.phoneNumber`
   are accepted exactly like a CLABE, on either door.
   The image door (imageUrl) is where every receipt lands first since
   two-eyes-receipt D3, so it carries scenarios of its own now, picked
   from the signed URL (the proof key is in it):
     contains "unreadable" → apiCEP's one named OCR failure: 200 + status
                        "error" with `missingFields`. The provider read
                        nothing, so the classification is blind on its
                        side (D12) — and the call is still billed
     contains "notfound"   → invalid with no cepStatus and no cepDetails
                        (reason not_found) *and* an `extracted` reading:
                        Banxico has nothing yet, but the provider's eyes
                        worked. This is the case the whole feature turns
                        on — two readings to compare at minute zero
     anything else         → valid, LIQUIDADO, with `extracted` beside the
                        CEP, which is what the real thing answers
   The `extracted` block echoes the mock's own clave and amount, so a
   manual walk agrees with a reader that read the same fixture — and
   `notfoundX` (any suffix) disagrees on the clave, which is the disputed
   row of the table.

   Headers ride 200s only, exactly like the real thing (measured
   2026-08-19): rate-limit trio plus X-Processing-Time, slow for a lookup
   that reached Banxico (~6.5 s) and fast for one that failed early
   (~1.3 s). */

import { createServer } from "node:http";
import { SENDER_4417, SENDER_8301, sandboxBundle, sandboxBundleOf, sandboxCdaChain } from "./cep-bundle.mjs";

const PORT = Number(process.env.PORT ?? 8789);

/* The measured shape: ISO 8601, about a month out */
const rateReset = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

const headers200 = (processingMs) => ({
  "Content-Type": "application/json",
  "X-RateLimit-Limit": "800",
  "X-RateLimit-Remaining": "767",
  "X-RateLimit-Reset": rateReset(),
  "X-Processing-Time": `${processingMs}ms`,
});

const beneficiaryAccountOf = (b = {}) => b.clabe ?? b.cardNumber ?? b.phoneNumber ?? null;

const cepDetails = (claim, beneficiary) => ({
  trackingKey: claim.trackingKey ?? "MOCK0000000000000000",
  /* receipt-triage D22: Banxico names the account that received it */
  beneficiaryAccount: beneficiaryAccountOf(beneficiary),
  beneficiaryAccountType: beneficiary?.cardNumber ? "TARJETA" : beneficiary?.phoneNumber ? "CELULAR" : "CLABE",
  amount: claim.amount ?? 514.0,
  operationDate: claim.date ?? "2026-08-15",
  senderBank: claim.bank ?? "BBVA MEXICO",
  senderName: "VALENTINA PEREZ (MOCK)",
  receiverBank: "BANORTE",
  beneficiaryName: "WIFIPLUS SA DE CV (MOCK)",
  digitalSignature: "bW9jay1zZWxsbw==",
});

/* proof-extraction D11 / two-eyes-receipt D5: what the provider's OCR
   read off the image, in the field the real apiCEP uses (`extracted`,
   read against `ApiCepResponse` in provider/apicep.ts). Measured
   2026-08-26: it is present and complete even on a faceless `invalid`,
   which is exactly when the comparison needs it. */
const extracted = (overrides = {}) => ({
  trackingKey: "MOCK0000000000000000",
  amount: 514.0,
  date: "2026-08-15",
  senderBank: "BBVA MEXICO",
  referenceNumber: "1234567",
  ...overrides,
});

function reply(body) {
  if (body.imageUrl?.includes("unreadable"))
    return {
      code: 200,
      headers: headers200(2100),
      json: {
        validationId: crypto.randomUUID(),
        status: "error",
        error: "El OCR no pudo extraer los siguientes datos obligatorios del comprobante (mock)",
        missingFields: ["fecha de la operación", "clave de rastreo o número de referencia"],
      },
    };

  /* The classification case: nothing in Banxico yet, but the provider
     read the image. A plain "notfound" reads the same clave the mock
     signs everything with (the agreed row of the table); any suffix
     makes it read a different one (the disputed row). */
  if (body.imageUrl?.includes("notfound")) {
    const disagrees = !/notfound(?=[^a-z0-9]|$)/i.test(body.imageUrl);
    return {
      code: 200,
      headers: headers200(1300),
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
        extracted: extracted(disagrees ? { trackingKey: "MOCK9999999999999999" } : {}),
      },
    };
  }

  const claim = body.sender ?? {};
  const key = claim.trackingKey ?? "";

  /* receipt-triage D1/D17: a search by reference alone */
  if (!key && claim.referenceNumber) {
    if (claim.referenceNumber === "9999999")
      return {
        code: 422,
        json: { error: "Referencia duplicada en Banxico (requiere clave de rastreo) (mock)" },
      };
    const payer = payerScenario(claim, body.beneficiary);
    if (payer) return payer;
    /* cep-bundle-match D1: several transfers share this reference */
    if (claim.referenceNumber === "4417000")
      return {
        code: 200,
        headers: headers200(4400),
        json: {
          validationId: crypto.randomUUID(),
          status: "invalid",
          validation: { banxicoConfirmed: true, cepPreviouslyValidated: null },
          downloads: { cepPdf: `http://localhost:${PORT}/mock-bundle.zip?day=${claim.date ?? ""}` },
        },
      };
    return {
      code: 200,
      headers: headers200(6500),
      json: {
        validationId: crypto.randomUUID(),
        status: "valid",
        validation: {
          banxicoConfirmed: true,
          cepStatus: "LIQUIDADO",
          cepPreviouslyValidated: false,
          /* Banxico's own clave — what the caller adopts (D14) */
          cepDetails: cepDetails({ ...claim, trackingKey: `MOCKREF${claim.referenceNumber}` }, body.beneficiary),
        },
      },
    };
  }

  if (key.includes("HANG")) return { hang: true };
  if (key.includes("E500")) return { code: 500, json: { error: "Internal server error (mock)" } };
  if (key.includes("R429"))
    return {
      code: 429,
      headers: { "Content-Type": "application/json", "X-RateLimit-Reset": rateReset() },
      json: { error: "Rate limit exceeded (mock)" },
    };
  if (key.includes("A401T"))
    return { code: 401, json: { error: "Missing or invalid Authorization header" } };
  if (key.includes("A401")) return { code: 401, json: { error: "Invalid or revoked API token" } };
  if (key.includes("B400"))
    return { code: 400, json: { error: "system must be either 'SPEI' or 'SPID'" } };
  if (key.includes("E400"))
    return {
      code: 400,
      json: {
        validationId: crypto.randomUUID(),
        status: "error",
        error:
          "El banco emisor y el banco receptor no pueden ser la misma institución. (mock)",
        confidence: 1,
        validation: { banxicoConfirmed: false },
        processingTime: { ocr: "0ms", total: "1.3s" },
      },
    };
  if (key.includes("D422"))
    return {
      code: 422,
      json: { error: "Referencia duplicada en Banxico; envía la clave de rastreo (mock)" },
    };
  if (key.includes("UNK"))
    return {
      code: 200,
      headers: headers200(1300),
      json: { validationId: crypto.randomUUID(), status: "reviewing" },
    };
  if (key.includes("ERR")) return { code: 503, json: { error: "Service temporarily unavailable (mock)" } };
  if (key.includes("PEND"))
    return {
      code: 200,
      headers: headers200(6500),
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
      },
    };
  if (key.includes("NF"))
    return {
      code: 200,
      /* The early-fail band: the provider gave up before Banxico */
      headers: headers200(1300),
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
    };
  if (key.includes("BAD"))
    return {
      code: 200,
      headers: headers200(6500),
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepStatus: "DEVUELTO", cepPreviouslyValidated: null },
      },
    };
  return {
    code: 200,
    headers: headers200(6500),
    json: {
      validationId: crypto.randomUUID(),
      status: "valid",
      /* An image-door call carries the OCR reading beside the CEP, as
         the real thing does; a transfer-door call read no image and
         carries none (two-eyes-receipt D5) */
      ...(body.imageUrl ? { extracted: extracted() } : {}),
      validation: {
        banxicoConfirmed: true,
        cepStatus: "LIQUIDADO",
        cepPreviouslyValidated: key.includes("DUP"),
        cepDetails: cepDetails(claim, body.beneficiary),
      },
      downloads: {
        cepXml: `http://localhost:${PORT}/mock-cep.xml`,
        cepPdf: `http://localhost:${PORT}/mock-cep.pdf`,
      },
    },
  };
}

/* ---- payment-without-receipt T008: a payer's own reference ---- */

const pesos = (amount) => (typeof amount === "number" ? amount.toFixed(2) : "3.00");
const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
/* "…22": the first day each reference was asked — the day the payer gave */
const firstAsked = new Map();
/* the transfers of a several answer, kept for its download */
const payerBundles = new Map();

/* `n` ends the clave: a number for 012's scenarios, the four characters a
   tie-break answer reads for confirmation-hierarchy's (quickstart) */
const payerTransfer = (reference, day, creditTime, senderAccount, claim, beneficiary, n = 0) => ({
  clave: `MOCKREF${reference}${day.replace(/-/g, "")}${n}`.slice(0, 30),
  operationDay: day,
  creditDay: day,
  creditTime,
  senderAccount,
  amount: pesos(claim.amount),
  beneficiary: beneficiaryAccountOf(beneficiary) ?? undefined,
});

const notFound = () => ({
  code: 200,
  headers: headers200(1300),
  json: { validationId: crypto.randomUUID(), status: "invalid", validation: { banxicoConfirmed: false, cepPreviouslyValidated: null } },
});

function validFor(t, claim, beneficiary) {
  return {
    code: 200,
    headers: headers200(6500),
    json: {
      validationId: crypto.randomUUID(),
      status: "valid",
      validation: {
        banxicoConfirmed: true,
        cepStatus: "LIQUIDADO",
        cepPreviouslyValidated: false,
        cepDetails: {
          ...cepDetails({ ...claim, trackingKey: t.clave, date: t.operationDay }, beneficiary),
          processingTime: t.creditTime,
          cdaChain: sandboxCdaChain(t),
          senderAccountType: "40",
          senderAccount: t.senderAccount,
          certificateNumber: "00001000000999999999",
        },
      },
    },
  };
}

function severalFor(transfers) {
  const id = crypto.randomUUID();
  payerBundles.set(id, transfers);
  return {
    code: 200,
    headers: headers200(4400),
    json: {
      validationId: crypto.randomUUID(),
      status: "invalid",
      validation: { banxicoConfirmed: true, cepPreviouslyValidated: null },
      downloads: { cepPdf: `http://localhost:${PORT}/mock-bundle.zip?id=${id}` },
    },
  };
}

function payerScenario(claim, beneficiary) {
  const reference = claim.referenceNumber;
  if (!/^[1-9]\d{6}$/.test(reference) || reference === "4417000" || reference === "9999999") return null;
  const day = claim.date ?? mexicoCityToday();
  if (!firstAsked.has(reference)) firstAsked.set(reference, day);
  switch (reference.slice(-2)) {
    case "11":
      return validFor(payerTransfer(reference, day, "07:11:20", SENDER_8301, claim, beneficiary), claim, beneficiary);
    case "22":
      return day === dayBefore(firstAsked.get(reference))
        ? validFor(payerTransfer(reference, day, "21:58:04", SENDER_8301, claim, beneficiary), claim, beneficiary)
        : notFound();
    case "33":
      return severalFor([
        payerTransfer(reference, day, "07:11:20", SENDER_8301, claim, beneficiary, 1),
        payerTransfer(reference, day, "07:13:02", SENDER_8301, claim, beneficiary, 2),
      ]);
    case "44":
      return severalFor([
        payerTransfer(reference, day, "07:11:20", SENDER_8301, claim, beneficiary, "977I"),
        payerTransfer(reference, day, "11:40:47", SENDER_4417, claim, beneficiary, "0412"),
      ]);
    case "55":
      return severalFor([
        payerTransfer(reference, day, "07:11:20", SENDER_8301, claim, beneficiary, "A5510"),
        payerTransfer(reference, day, "11:40:47", SENDER_4417, claim, beneficiary, "B5510"),
      ]);
    case "66":
      return validFor(payerTransfer(reference, day, "09:02:31", SENDER_8301, claim, beneficiary, "3O10"), claim, beneficiary);
    default:
      return notFound();
  }
}

/* cep-bundle-match D16: the bundle behind a several answer, one per day
   asked, built on first request. Served as a PDF, as the provider serves
   it: the API must recognise it by its bytes (D3). */
const bundles = new Map();
const mexicoCityToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/mock-bundle.zip" && payerBundles.has(url.searchParams.get("id") ?? "")) {
    const zip = sandboxBundleOf(payerBundles.get(url.searchParams.get("id")));
    console.log(`  ${new Date().toISOString()} → a payer's bundle of CEPs (${zip.length} bytes)`);
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(zip.length) });
    res.end(Buffer.from(zip));
    return;
  }
  if (req.method === "GET" && url.pathname === "/mock-bundle.zip") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") ?? "") ? url.searchParams.get("day") : mexicoCityToday();
    if (!bundles.has(day)) bundles.set(day, sandboxBundle(day));
    const zip = bundles.get(day);
    console.log(`  ${new Date().toISOString()} → bundle of CEPs for ${day} (${zip.length} bytes)`);
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(zip.length) });
    res.end(Buffer.from(zip));
    return;
  }
  if (req.method !== "POST" || req.url !== "/validate-transfer") {
    res.writeHead(404).end();
    return;
  }
  if (!(req.headers.authorization ?? "").startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid Authorization header" }));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const answer = reply(JSON.parse(raw || "{}"));
    if (answer.hang) {
      console.log(`  ${new Date().toISOString()} → (hanging on purpose, D16)`);
      return; /* never answered; the socket stays open */
    }
    const { code, headers, json } = answer;
    console.log(`  ${new Date().toISOString()} → ${code} ${json.status ?? json.error}`);
    res.writeHead(code, headers ?? { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
}).listen(PORT, () => {
  /* cep-bundle-match T019: today's bundle is built at startup, so a broken
     build shows here and not on the first several answer */
  bundles.set(mexicoCityToday(), sandboxBundle(mexicoCityToday()));
  console.log(`apiCEP mock listening on http://localhost:${PORT}`);
});
