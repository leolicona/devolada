---
status: in-development
stories: [US-C05]
domain: charges
updated: 2026-08-14
debt: [TD-003]
---

# Spec: Receipt (comprobante)

The end customer pays cash at a corner store and walks out with nothing in hand. The folio is their proof, and this spec is how it reaches them: the shopkeeper sends it from their own WhatsApp, in one tap, with the text already written.

## Decisions

- **D1 — The store sends the receipt; we do not.** The result screen opens WhatsApp with the message ready (`wa.me` link), from the shopkeeper's own number. **Rejected for now**: sending through a provider — Meta's WhatsApp Business API needs business verification, a verified number and pre-approved templates, which is weeks the pilot does not have to wait. This is the same shape as the store invitation (stores D2): a link the human sends beats a fake "sent" state. The owner's decision (2026-08-14) is that Meta arrives as its own later feature; **TD-003 stays open** and this is what ships in the meantime.
- **D2 — The API owns the text, not the PWA.** `GET /charges/:id/receipt` returns the finished message. The copy must read identically wherever it is sent from, money formatting is already a server-side law (integer cents in, `formatMoney` shape out), and when Meta does arrive this same text becomes the template body instead of being rewritten in a second place.
- **D3 — No phone number is not a dead end.** The receipt links to `wa.me/<number>` when we know the customer's phone and to `wa.me/?text=…` when we do not — WhatsApp then opens its contact picker and the shopkeeper chooses the chat. This is the common case, not the rare one: every customer on the WispHub sandbox has an empty `telefono`, and a pilot ISP's data will be uneven. A copy button backs both paths.
- **D4 — The phone is copied onto the charge when it is recorded.** Reading it back from WispHub at receipt time would make the receipt fail exactly when WispHub is down — the moment the charge most needs to explain itself. Same reasoning as the customer name we already store.
- **D5 — The text tells the truth about the reconnection.** Built at read time from the charge's current status: `reconnected` says the service is already active, `queued` says it will come back in a few minutes, `failed` tells the customer to contact the ISP with their folio. The store PWA polls the charge, so re-opening the receipt after a retry succeeds gives the updated wording.
- **D6 — Sending never blocks or delays the charge.** Nothing in the charge path waits on a receipt. When a provider does ship, its sends queue and retry on the sweep the reconnection queue already runs, and this link stays as the fallback — the same rule the whole product follows: WispHub cannot reject a charge, and neither can a messaging provider.
- **D7 — We do not record "receipt sent".** We cannot know whether the shopkeeper pressed send or whether it arrived, so a `sent` flag would be a claim we cannot support. The folio in the ledger is the record. **Revisited** when a provider gives us real delivery receipts.

## Contract

`GET /charges/:id/receipt` (store session; own charges only, foreign → 404)

```
{ folio, customerName, totalCents, monthlyFeeCents, serviceFeeCents,
  reconnectionStatus, text, waLink, phone }
```

- `text` — the full es-MX message, already formatted
- `waLink` — `https://wa.me/<digits>?text=<encoded>` or `https://wa.me/?text=<encoded>` when the phone is unknown (D3)
- `phone` — E.164 digits (Mexico: `52` + 10 digits) or `null`

`charges.customer_phone` is written at record time (D4).

## UI Contract

- Result screen, under the status: **"Enviar comprobante"** (primary, opens WhatsApp) and **"Copiar comprobante"** (secondary, clipboard). Both stay available while the charge is `queued` — the customer should not wait for the reconnection to get their proof.
- When the phone is unknown, the button says the same thing; WhatsApp opens the picker (D3). No error, no apology.
- The folio stays visible in mono on the screen itself: the receipt of last resort is the customer writing it down.
- Plain es-MX, no jargon: "comprobante", never "ticket".

## Scenarios

1. The receipt carries the folio, the breakdown and a `wa.me` link with the customer's phone (US-C05, D2)
2. Without a phone, the link is the no-number form and `phone` is null (D3)
3. The text follows the reconnection status: active, in a few minutes, or contact the ISP (D5)
4. A foreign charge → 404; an ISP session → 403
5. UI: the result screen offers to send and to copy, and shows the folio (US-C05)

## Definition of Done

- [x] Scenarios 1–4 automated in the API layer (`test/receipt.test.ts`, 5 tests)
- [x] Scenario 5 automated with Testing Library + MSW (`apps/tienda/test/charge-result.test.tsx`, 2 tests)
- [ ] Real check: a charge on the deployed PWA opens WhatsApp with the message ready
