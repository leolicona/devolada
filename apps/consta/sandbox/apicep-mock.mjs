#!/usr/bin/env node
/* Local apiCEP stand-in (validation spec, "Local sandbox").
   apiCEP has no sandbox of its own (docs checked 2026-08-17), so this
   little server plays its part for manual dev: point APICEP_BASE_URL at
   it and no request ever leaves the machine or spends a credit.

   The trackingKey picks the scenario:
     contains "PEND" → invalid + cepStatus EN PROCESO (Consta must say pending)
     contains "DUP"  → valid, cepPreviouslyValidated true (replay flag)
     contains "BAD"  → invalid, cepStatus DEVUELTO (Consta: reason contradicted)
     contains "NF"   → invalid, no cepStatus and no cepDetails (reason not_found)
     contains "ERR"  → HTTP 503 (Consta must say PROVIDER_ERROR)
     anything else   → valid, LIQUIDADO, echoing the claimed data
   The receipt door (imageUrl) always answers valid with fixed data — it is
   reached only by PDFs now (proof-extraction D2); an image is read at
   Consta's edge and arrives here as a direct-mode call like any other. */

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

  if (key.includes("ERR")) return { code: 503, json: { error: "Service temporarily unavailable (mock)" } };
  if (key.includes("PEND"))
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepStatus: "EN PROCESO", cepPreviouslyValidated: null },
      },
    };
  if (key.includes("NF"))
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepPreviouslyValidated: null },
      },
    };
  if (key.includes("BAD"))
    return {
      code: 200,
      json: {
        validationId: crypto.randomUUID(),
        status: "invalid",
        validation: { banxicoConfirmed: false, cepStatus: "DEVUELTO", cepPreviouslyValidated: null },
      },
    };
  return {
    code: 200,
    json: {
      validationId: crypto.randomUUID(),
      status: "valid",
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
