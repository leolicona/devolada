---
status: in-development
stories: [US-D07]
domain: direct-payment
updated: 2026-08-17
---

# Spec: Admin Payment Links View

Allows ISP administrators to search their WispHub customers and share permanent SPEI payment links via WhatsApp directly from the Devolada Pagos admin dashboard.

## Decisions

- **D1 — Dedicated top-level tab.** The view lives as a dedicated main navigation tab in `apps/admin` (e.g. "Enlaces SPEI") next to Feed and Stores. **Rejected:** Hiding it inside Settings (payment links are a primary operation for the ISP when dealing with customers).
- **D2 — Server-side search over WispHub.** The ISP needs to find a specific customer out of hundreds or thousands. The view provides a search bar that queries WispHub (name, usuario, or phone) and pairs the results with their Devolada payment link. **Rejected:** Local filtering (cursor pagination means not all customers are loaded).
- **D3 — WhatsApp deep link sharing, built by the API.** Sharing is the point of the screen, so the response carries a finished `waLink` and the admin only opens it. Message and number both come from the API, for the reason the receipt's text already does (receipt spec D2): the same words should reach the customer whoever sends them. The number goes through `toWhatsAppPhone` (receipt spec D3) — it puts Mexico's `52` in front of the 10-digit numbers WispHub actually stores, normalizes the `+52` and legacy `521` shapes an ISP may have typed, and returns nothing for a phone it cannot read confidently, in which case `wa.me/?text=…` opens WhatsApp's contact picker. **Rejected:** building the URL in the admin from the raw `phone` field. That was the first implementation and it was wrong: `5512345678` became `wa.me/5512345678`, which WhatsApp reads as country code **55 — Brazil**, so the ISP would have sent a customer's payment link into a stranger's chat. The helper that prevents it already existed for the receipt; duplicating the logic in the frontend is what lost the country code. **Rejected:** only copying to clipboard (too much friction for the main workflow; the copy button stays as the secondary action).
- **D4 — API extension for searching links.** The backend provides `GET /direct-payments/links/search?q=`, which calls WispHub's search, lazily generates payment links for the results that lack one, and returns `{ wisphubId, name, usuario, phone, url, waLink }`. A customer whose link could not be resolved is left out of the results rather than returned with a `/p/undefined` URL. **Rejected:** Doing the join entirely on the client side with two API calls.

## Contract

`GET /direct-payments/links/search?q=XYZ`
(ISP session required, US-D07, D4)

Queries WispHub for customers matching `q`. For each matching customer, ensures a payment link exists in `payment_links` and returns the joined data.

```
200 {
  success: true,
  data: {
    results: [
      {
        wisphubId: 123,
        usuario: "juanperez",
        name: "Juan Perez",
        phone: "5551234567" | null,
        url: "https://pago.dev.devoladapago.com/p/<token>",
        waLink: "https://wa.me/525551234567?text=<message with the url>"
      }
    ]
  }
}
```
- `waLink` is always present and always openable (D3): with the number when the phone can be read, `wa.me/?text=…` when it cannot, so a stranger's chat is never the destination.
- If WispHub is unavailable or the ISP lacks a WispHub key, returns `503 WISPHUB_UNAVAILABLE` or `WISPHUB_NOT_CONFIGURED` respectively.
- `q` is trimmed and must be at least 2 characters, matching the customer search the store PWA already uses; shorter answers Hono's `zValidator` 400.

## UI Contract

`apps/admin/src/features/links/LinksScreen.tsx`

- A standard list-view page (like `StoresScreen`).
- Title: "Enlaces SPEI".
- Search input at the top (`packages/ui/src/components/search-input.tsx` or similar).
- For each search result, displays the customer name, WispHub `usuario`, and the `wa.me` share button (D3).
- Uses standard UI components.
- Handles empty states and loading states gracefully.

## Definition of Done

- [x] Backend: `GET /direct-payments/links/search` implemented with lazy link generation.
- [x] Frontend: `LinksScreen` created and added to the `router.tsx` navigation.
- [x] Frontend: Navigation item added to `Shell.tsx` sidebar.
- [x] Automated tests for the new backend route (`apps/api/test/direct-payments-links.test.ts`, 8 tests): the lazy join, the permanent token across two searches, the session guard (the route sits under the public `/links/:token` prefix, so the order that keeps it private is tested rather than assumed), and four on D3's number — the `52` prefix, the `+52`/`521` shapes, an unreadable phone falling back to the picker, and no phone at all.
- [ ] Feature tested locally end-to-end.
- [ ] Open, from the review: the search path creates a link for a customer WispHub returns without `usuario`, storing `customer_usuario = ""` — a permanent link that cannot resolve its customer. `listLinks`'s batch generator already skips those; this path should too.
