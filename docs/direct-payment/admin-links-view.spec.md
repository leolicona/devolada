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
- **D3 — WhatsApp deep link sharing.** The primary action is sharing the link. The "Share via WhatsApp" button opens `wa.me` with a pre-filled message ("Hola, aquí está tu enlace permanente de pago: [URL]"). If the customer has a phone number registered in WispHub, it includes the number (`wa.me/<phone>?text=...`) to route directly to the chat. If not, it opens `wa.me/?text=...` and prompts the admin to select a contact in the WhatsApp app. **Rejected:** Only copying to clipboard (adds friction for the ISP's main workflow).
- **D4 — API extension for searching links.** The backend provides an endpoint `GET /direct-payments/links/search?q=` that internally calls WispHub's search, extracts the customers, lazily generates payment links for them if missing, and returns `{ wisphubId, name, usuario, phone, url }`. **Rejected:** Doing the join entirely on the client side with two API calls.

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
        url: "https://pago.dev.devoladapago.com/p/<token>"
      }
    ]
  }
}
```
- If WispHub is unavailable or the ISP lacks a WispHub key, returns `503 WISPHUB_UNAVAILABLE` or `WISPHUB_NOT_CONFIGURED` respectively.
- If `q` is empty, it returns `400 BAD_REQUEST`.

## UI Contract

`apps/admin/src/features/links/LinksScreen.tsx`

- A standard list-view page (like `StoresScreen`).
- Title: "Enlaces SPEI".
- Search input at the top (`packages/ui/src/components/search-input.tsx` or similar).
- For each search result, displays the customer name, WispHub `usuario`, and the `wa.me` share button (D3).
- Uses standard UI components.
- Handles empty states and loading states gracefully.

## Definition of Done

- [ ] Backend: `GET /direct-payments/links/search` implemented with lazy link generation.
- [ ] Frontend: `LinksScreen` created and added to the `router.tsx` navigation.
- [ ] Frontend: Navigation item added to `Shell.tsx` sidebar.
- [ ] Automated tests for the new backend route (`apps/api/test/direct-payments-links.test.ts` o similar).
- [ ] Feature tested locally end-to-end.
