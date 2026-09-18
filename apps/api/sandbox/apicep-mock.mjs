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

const cepDetails = (claim) => ({
  trackingKey: claim.trackingKey ?? "MOCK0000000000000000",
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
        cepDetails: cepDetails(claim),
      },
      downloads: {
        cepXml: `http://localhost:${PORT}/mock-cep.xml`,
        cepPdf: `http://localhost:${PORT}/mock-cep.pdf`,
      },
    },
  };
}

createServer((req, res) => {
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
}).listen(PORT, () => console.log(`apiCEP mock listening on http://localhost:${PORT}`));
