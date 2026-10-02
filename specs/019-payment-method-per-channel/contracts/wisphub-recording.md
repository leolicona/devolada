# Contract: recording a payment in WispHub (adapter → provider)

The WispHub adapter's side of D3–D7. These are the provider's own routes
and fields, measured in the spec's R4–R13; they belong to the adapter and
never appear in the core (constitution IX).

## 1. Read the payment methods

`GET /formas-de-pago/`, today's call, paged with `limit` and `offset`
while the provider reports more (`next` not null), within the client's
operation budget. How many methods fit on the provider's default page was
not measured, so the adapter must not assume one page: a business with
many methods could have Devolada's on the second.

```json
{ "next": null, "results": [ { "id": 7, "nombre": "efectivo" }, { "id": 12, "nombre": "SPEI - LINK.DEVOLADAPAGO" }, … ] }
```

- Each method has only `id` and `nombre` (R8). The list is read-only
  (R6): Devolada never creates, edits or deletes a method (FR-010).
- Cached per business and installation address for ten minutes (D3).
  Dropping the entry (D6) clears it in this data center only
  (`cache.delete` is per colo, `wisphub/cache.ts`); elsewhere the same
  400 falls back the same way until the entry expires.
- The order is the provider's: it decides today's cash method (D4, R11).

## 2. Choose

1. The channel's name, `SPEI - LINK.DEVOLADAPAGO` or
   `CASH - RED.DEVOLADAPAGO`, compared after normalization (D5). Several
   matches → the lowest `id`.
2. No match → the cash method: the first `nombre` matching `/efect|cash/i`
   that is not one of Devolada's two names; else the first method that is
   not one of them; else the first method (D4).

## 3. Record

`POST /api/facturas/{invoiceId}/registrar-pago/`

```json
{
  "forma_pago": 12,
  "accion": 1,
  "fecha_pago": "2026-10-02 09:50",
  "total_cobrado": 350,
  "referencia": "DV-PRUEBA1 · MBAN01002610020000001"
}
```

- `referencia` is new; the other four fields are sent exactly as today
  (`accion` 1 or 0 by the business's mapped action, `total_cobrado` from
  integer cents).
- `referencia` follows D7: `folio · clave` (SPEI) or `folio · tienda`
  (store), at most 200 characters, only the store's name shortened.
- Measured answers:

| Answer | Meaning | What the adapter does |
| --- | --- | --- |
| 200 | Recorded with that method and reference (R10) | As today |
| 400 `{"forma_pago": ["Clave primaria \"…\" inválida - objeto no existe."]}` | The method does not exist; nothing recorded (R9) | If the method was Devolada's: drop the cached list and send the same payment once more with the cash method (D6) |
| 400 naming any other field | Unchanged | `INTEGRATION_UNAVAILABLE`, as today |
| 422 | The invoice is already paid | As today: the money landed (reconnection D8) |
| 401 / 403 | The key is refused | As today: `INTEGRATION_AUTH_FAILED` |

## 4. What the business sees

The invoice carries the method and, under *Transacciones*, "Forma de Pago:
… - Referencia: …" in the panel and its PDF (R12). The panel's invoice
list filters paid invoices by the method and downloads the list (R13).
