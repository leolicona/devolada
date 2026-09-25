# Contract: the reader in `/operador` — model choice and test bench

**Area**: `apps/api/src/routes/reader/{index,handler,schema}.ts`, exported as
`@devolada/api/reader-schema` (constitution III, research R4). The operator
router is mounted at **`/platform/reader`** by `routes/platform/index.ts`,
so every route sits behind `requireSession, requirePlatformOperator` like
the rest of the platform area. Envelope as everywhere:
`{ success: true, data }` / `{ success: false, error: { code } }`.

Any caller who is not the platform operator gets today's platform refusal
(`NOT_PLATFORM_OPERATOR`, 403) on every route below (FR-005, FR-021).

## `GET /platform/reader` — the model and its state (Story 1)

```ts
readerStateResponse = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() })), // the resolved list, default first
  defaultModel: z.string(),                    // id
  activeModel: z.string(),                     // id that reads from the next reading on
  choice: z.enum(["default", "applies", "stale"]),
  //   default — no choice ever made
  //   applies — the latest choice is in the list and is the active model
  //   stale   — the latest choice is no longer in the list; the default reads
  staleChoice: z.string().nullable(),          // the stale id, when choice = "stale"
  history: z.array(z.object({                  // latest first, up to 5
    value: z.string(), authorUserId: z.string(), createdAt: z.number().int(),
  })),
  fallbacksLast7Days: z.number().int(),        // payer readings with fallback_from set — constitution V (v1.6.0)
  questionVersion: z.string(),                 // QUESTIONS_VERSION
  readerAvailable: z.boolean(),                // false when the AI binding is absent (constitution VIII)
});
```

## `POST /platform/reader/model` — choose (Story 1)

```ts
chooseModelRequest = z.object({ modelId: z.string().min(1) });
```

- `201` → `readerStateResponse` after the write. Appends one
  `platform_settings` row (`reader_model`, author = the operator).
- `400 INVALID_MODEL` — the id is not in the environment's list. Nothing is
  written. There is no way to store an id outside the list (FR-003).
- Choosing the default writes a row too (the history shows the switch
  back); `choice` then reads `applies`.

## `POST /platform/reader/bench` — upload and read (Story 3)

`multipart/form-data`, field `file` — the payer upload's own rules
(`uploadProof`): ≤ 1 MB, an image or a PDF by declared type, then sniffed by
magic bytes.

- `201` → `benchReceiptDetail` (below): the file stored at `bench/<uuid>`,
  and every listed model's reading, made in parallel, 30 s each, no
  fallback, the PDF converted once.
- `200` → `benchReceiptDetail` with `duplicate: true` when a bench receipt
  with the same SHA-256 exists. Nothing is re-read; the page offers "Leer
  de nuevo" when combinations are missing.
- `400 VALIDATION_ERROR` (no file), `413 PROOF_TOO_LARGE`,
  `415 PROOF_UNSUPPORTED_TYPE` (declared type, or magic bytes that are
  neither an image nor a PDF).
- `503 READER_UNAVAILABLE` — no AI binding. Nothing is stored.

Never: a payment, a validation row, an `extractions` row, a credit entry, a
provider call (FR-019).

## `GET /platform/reader/bench` — the receipts

Query: `cursor?` (opaque). Newest first, 25 per page.

```ts
benchReceiptSummary = z.object({
  id: z.string(),
  mediaType: z.string(),
  byteSize: z.number().int(),
  createdAt: z.number().int(),
  fileAvailable: z.boolean(),                  // false once the 15-day rule removed it
  readings: z.array(z.object({                 // one per (model, version)
    id: z.string(), model: z.string(), modelLabel: z.string(),
    questionVersion: z.string(), status: z.enum(["read", "failed"]),
    readerMs: z.number().int(), marked: z.number().int(), // fields marked
  })),
});
benchListResponse = z.object({ items: z.array(benchReceiptSummary), nextCursor: z.string().nullable() });
```

## `GET /platform/reader/bench/:id` — one receipt, side by side

```ts
benchField = z.enum([
  "isReceipt", "legibility", "trackingKey", "referenceNumber",
  "senderBank", "receivingBank", "amount", "date", "destination",
]);
benchMark = z.enum(["right", "wrong", "absent"]);
benchReading = z.object({
  id: z.string(), model: z.string(), modelLabel: z.string(),
  questionVersion: z.string(),
  status: z.enum(["read", "failed"]),
  failureCode: z.enum(["READER_UNAVAILABLE", "READER_UNREADABLE", "TIMEOUT"]).nullable(),
  readerMs: z.number().int(),
  reading: z.object({                          // after the gate and the vocabulary (D17)
    isReceipt: z.boolean(),
    legibility: z.enum(["full", "partial", "none"]).nullable(),
    trackingKey: z.string().nullable(),
    referenceNumber: z.string().nullable(),
    senderBank: z.string().nullable(),
    receivingBank: z.string().nullable(),
    amountCents: z.number().int().nullable(),
    date: z.string().nullable(),
    destination: z.object({ kind: z.enum(["clabe", "card", "phone", "account"]).nullable(), digits: z.string().nullable() }),
    sameBank: z.boolean(),
  }).nullable(),                               // null when failed
  rawOutput: z.string().nullable(),
  marks: z.record(benchField, benchMark),      // partial
  judged: z.record(benchField, z.enum(["right", "wrong"])), // marks resolved (absent judged)
  markedAt: z.number().int().nullable(),
});
benchReceiptDetail = benchReceiptSummary.omit({ readings: true }).extend({
  readings: z.array(benchReading),
  missing: z.array(z.object({ model: z.string(), questionVersion: z.string() })), // what "Leer de nuevo" would fill
  duplicate: z.boolean().optional(),
});
```

- `404 NOT_FOUND` — no such bench receipt.

## `GET /platform/reader/bench/:id/file` — the image or PDF

The bytes with their sniffed `Content-Type` and `Cache-Control: no-store`.
`404 FILE_EXPIRED` once the bucket's rule removed it (the row stays).

## `POST /platform/reader/bench/:id/read` — read again

Reads with every (listed model × current question version) combination the
receipt does not have yet, in parallel, same rules as the upload.

- `200` → `benchReceiptDetail`. With nothing missing, nothing is read.
- `404 NOT_FOUND`, `404 FILE_EXPIRED`, `503 READER_UNAVAILABLE`.

## `PUT /platform/reader/bench/readings/:readingId/marks` — mark

```ts
setMarksRequest = z.object({ marks: z.record(benchField, benchMark) }); // replaces the reading's marks
```

- `200` → `benchReading`.
- `400 VALIDATION_ERROR` — an `absent` mark on `isReceipt` or `legibility`
  (never "not shown"), or any mark on a `failed` reading.
- `404 NOT_FOUND`.

## `GET /platform/reader/bench/tally` — the results

```ts
benchTallyResponse = z.object({
  asOf: z.number().int(),
  rows: z.array(z.object({
    model: z.string(), modelLabel: z.string(), questionVersion: z.string(),
    readings: z.number().int(), failures: z.number().int(),
    judged: z.number().int(), right: z.number().int(),
    wrongByField: z.record(benchField, z.number().int()),
    p90Ms: z.number().int().nullable(),        // null with no `read` reading
  })),
});
```

## The Lector tab (admin) — behaviour and copy (es-MX)

`/operador` gains a fourth tab, **Lector**, after Landing (research R13).
Compact size (40 px), tokens only, status as icon + text, keyboard-complete
(constitution VI).

**Modelo** card

- Title "Modelo que lee los comprobantes". Line: "Lo usan todas las lecturas
  de este ambiente a partir de la siguiente."
- The active model's label, with "Por defecto" when it is the default.
- `stale`: an `Alert` — "La elección anterior ({staleChoice}) ya no está
  disponible; lee el modelo por defecto."
- "Respaldos en los últimos 7 días: {n}" — with an info icon when n > 0:
  "El modelo elegido falló y leyó el modelo por defecto."
- A select of the list and the button "Usar este modelo" (disabled while
  unchanged). One model in the list → the select is shown disabled with the
  line "Este ambiente tiene un solo modelo."
- "Cambios recientes": value, author, time — as the Reglas history.
- `readerAvailable: false` → `Alert`: "Este ambiente no tiene lector; los
  comprobantes van directo al proveedor." The choice can still be saved.

**Banco de pruebas** card

- Line: "Sube un comprobante: lo leen todos los modelos disponibles, sin
  crear pagos ni gastar créditos."
- Button "Subir comprobante" (image or PDF). While reading: the `Pending`
  breath with "Leyendo con {n} modelos…".
- Duplicate: "Este comprobante ya estaba en el banco."
- The list, newest first: time, type, and per model "leído en 3.1 s" or
  "falló", plus "{marked} de 9 revisados".

**Detail** (a receipt)

- The image (or "Abrir PDF") beside one column per reading; below 768 px the
  columns stack under the image.
- Rows: "¿Es comprobante?", "Legibilidad", "Clave de rastreo",
  "Referencia", "Banco emisor", "Banco receptor", "Monto", "Fecha",
  "Destino". A value not shown reads "No se ve". "Mismo banco" appears as an
  icon + text flag beside the two banks when `sameBank`.
- Each value has a three-way mark control: "Correcto", "Incorrecto", "No
  aparece" (the last not offered on the first two rows), each icon + text.
  Saved per reading with "Guardar revisión".
- A failed column: "No respondió", "Respuesta sin datos" or "Tardó
  demasiado", with the raw answer.
- "Ver respuesta del modelo": the raw answer in a `Collapsible`.
- "Leer de nuevo" when `missing` is not empty ("Falta leer con: …").
- File gone: "La imagen ya se borró (se guarda 15 días). Las lecturas y tu
  revisión se conservan."

**Resultados** card

- One row per model and version: "Modelo", "Versión", "Lecturas",
  "Fallas", "Campos revisados", "Correctos" (count and %), "9 de 10 en"
  (seconds), "Más errores en" (the two fields with most wrong).
- "Al {asOf}" above the table — the date that goes into the reader's
  measurement (FR-020).
