#!/usr/bin/env node
/* Local apiCEP stand-in (validation spec, "Local sandbox").
   apiCEP has no sandbox of its own (docs checked 2026-08-17), so this
   little server plays its part for manual dev: point APICEP_BASE_URL at
   it and no request ever leaves the machine or spends a credit.

   The trackingKey picks the scenario:
     contains "PEND" → invalid + cepStatus EN PROCESO (Consta must say pending)
     contains "DUP"  → valid, cepPreviouslyValidated true (replay flag)
     contains "BAD"  → invalid, cepStatus DEVUELTO
     contains "ERR"  → HTTP 503 (Consta must say PROVIDER_ERROR)
     anything else   → valid, LIQUIDADO, echoing the claimed data
   The receipt door (imageUrl) answers valid with fixed data, unless the
   URL contains "blur" → the real failure measured 2026-08-18: a receipt
   the OCR could not read comes back `invalid` with NO cepDetails, exactly
   like a transfer that never happened. `confidence` is the only thing
   telling them apart (D9), so the mock has to be able to produce it. */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8789);

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

function reply(body) {
  const claim = body.sender ?? {};
  const key = claim.trackingKey ?? "";

  /* Receipt door, unreadable image: a verdict with nothing behind it */
  if (String(body.imageUrl ?? "").includes("blur")) {
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        confidence: 0.12,
        validation: { banxicoConfirmed: false, cepStatus: null, cepPreviouslyValidated: null },
      },
    };
  }

  if (key.includes("ERR")) return { code: 503, json: { error: "Service temporarily unavailable (mock)" } };
  if (key.includes("PEND"))
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        confidence: 1,
        validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
      },
    };
  if (key.includes("BAD"))
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        confidence: 1,
        validation: { banxicoConfirmed: false, cepStatus: "DEVUELTO", cepPreviouslyValidated: null },
      },
    };
  return {
    code: 200,
    json: {
      validationId: crypto.randomUUID(),
      status: "valid",
      /* 1 in transfer mode: nothing was read (D9) */
      confidence: 1,
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
    const { code, json } = reply(JSON.parse(raw || "{}"));
    console.log(`  ${new Date().toISOString()} → ${code} ${json.status ?? json.error}`);
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
}).listen(PORT, () => console.log(`apiCEP mock listening on http://localhost:${PORT}`));
