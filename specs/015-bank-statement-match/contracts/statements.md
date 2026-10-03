# Contract: the statement (Phases B and C)

A new area, `routes/statements/{index,handler,schema}.ts`, exported as
`@devolada/api/statements-schema` (and added to `apps/api/package.json`).
Built after Phase A; written now so Phase B's core can be tested with
synthetic credits before any bank's reader exists (D1, D12).

## The reader interface (core ↔ Phase C)

```ts
/* bank-statement-match D12: what every bank's reader returns. The core
   never sees the file again. */
export type StatementMovement = {
  kind: "spei_credit" | "same_bank_credit" | "other";
  operationDate: string;        // YYYY-MM-DD — the day matched
  settlementDate?: string;      // differs on weekends; never matched
  amountCents: number;          // parsed by the core's money parsers
  senderName?: string;
  senderAccount?: string;       // as printed (CLABE, account or tail)
  reference?: string;           // the payer's numeric reference
  concept?: string;
  clave?: string;               // SPEI only
  folio?: string;               // same-bank only, when printed
};

export type StatementRead = {
  bank: string;                 // from BANKS
  format: string;               // e.g. "bbva_netcash_v1"
  accountTail?: string;         // when the file names its account
  periodFrom: string;           // YYYY-MM-DD
  periodTo: string;
  movements: StatementMovement[];
  unreadable: number;           // lines the reader could not parse
};

export interface StatementReader {
  format: string;
  bank: string;
  /* true when this file is this reader's layout; never throws */
  recognizes(file: { name: string; type: string; bytes: Uint8Array }): boolean;
  read(file: { name: string; type: string; bytes: Uint8Array }, env: Bindings): Promise<StatementRead>;
}
```

No reader is registered until its real file is measured (D16).

## `POST /statements`

`requireArea("payments", "operate")`. `multipart/form-data` with one
`file` (≤ 5 MB).

| Outcome | Answer |
| --- | --- |
| Read and matched | `200 { data: importReport }` |
| No reader recognizes it | `422 STATEMENT_FORMAT_UNSUPPORTED`, with `supportedBanks: string[]` — nothing imported (FR-001) |
| The file names an account that is not the collection account | `422 STATEMENT_OTHER_ACCOUNT` — nothing imported |
| Too large | `413 STATEMENT_TOO_LARGE` |

```ts
export const importReport = z.object({
  id: z.string(),
  bank: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  counts: z.object({
    read: z.number().int(),
    matched: z.number().int(),
    already: z.number().int(),
    unmatched: z.number().int(),
    skipped: z.number().int(),
    unreadable: z.number().int(),
    notReceived: z.number().int(),   // same-bank payments ended by this file (FR-023)
  }),
});
```

## `GET /statements`

`requireArea("payments", "read")`. The imports, newest first: bank,
period, who, when, counts (FR-013).

## `GET /statements/credits?fate=unmatched`

`requireArea("payments", "read")`. "Abonos sin cliente": date, amount,
sender, reference, concept, and `namedCustomer` when a registered
reference names one (FR-011). Also `fate=held_undecided`: credits listed
as belonging to an undecided 013 payment. The answer carries `canAssign:
boolean` — false when the business's integration cannot search its
customers, a business on the `/v1` API alone (D18).

## `POST /statements/credits/:id/assign`

`requireArea("payments", "operate")`. Body: the customer (as the links
search returns it). Creates and settles the customer's payment from the
credit (partial and overpayment rules apply), records `assigned_by`, and
answers the payment. A credit already matched or assigned → `409
CREDIT_ALREADY_USED`; an integration that cannot search customers → `409
ASSIGNMENT_UNAVAILABLE` (FR-012, D18).

## The panel screen "Estado de cuenta"

Upload with the supported banks named; the last report; the imports;
"Abonos sin cliente" with **Asignar** (search a customer, confirm in an
`AlertDialog`) when `canAssign`; without it, the list alone.
