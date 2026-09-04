---
status: in-development
stories: [US-P07]
domain: polish
updated: 2026-09-04
debt: []
---

# Spec: A read screen stays current while someone is looking — no refresh button

The two admin screens that mirror WispHub — **Cobros** (cobros-live) and **Links de pago** (admin-links-view) — carried a header button, "Actualizar", next to "consultado hace X min". The button was honest work: the data is a snapshot of a provider that is slow and stalls, so the operator needed a way to say *now*. But it was also a chore handed to the user for a decision the app can make on its own — *someone is here, looking at a list that may have moved*.

This spec removes the button and replaces the click with **signals of presence**: the tab becoming visible again, a slow heartbeat while the person is active, and — for Cobros — Devolada's own knowledge that a payment just got registered in WispHub. It also pays TD-014 (the provider cache moves from the isolate to the colo) because a heartbeat per open tab is exactly the load an isolate cache does not dampen, and fixes the one lie the freshness label could tell (BUG-013).

**Owner decisions, 2026-09-03 (grill session).** Scope: both screens. Signal: focus + heartbeat + the internal payment pulse. Heartbeat 3 min, off after 5 min without interaction. Pulse every 30 s. Freshness label stays; a background failure is a quiet note, never a repainted error. TD-014 paid now, with the invalidation carried in the cache key. The Feed keeps its 5 s poll, paused only when the tab is hidden.

## Decisions

- **D1 — No read screen has a refresh button.** A healthy screen offers nothing to press about freshness; the only manual escape is the browser's own reload (desktop F5, mobile pull-to-refresh — the admin is not installed as a PWA, so the native gesture is always there). The retry that remains is `ListError`'s "Reintentar" (list-states D2), which exists only when there is **nothing** to show. **Rejected:** keeping the button "just in case" — two models for one datum (the button says "you decide", the heartbeat says "I decide"), and the pilot-UX round already measured that the header's control competed with the list's own actions on a phone. **Rejected:** a custom pull-to-refresh — the browser ships one.

- **D2 — Presence is visibility plus interaction, not focus alone.** A tab counts as *present* while `document.visibilityState` is visible **and** the last pointer, key, scroll or touch was under **5 minutes** ago. TanStack's own guard (`refetchIntervalInBackground: false`) pauses on a hidden tab, but a focused tab on an unattended monitor would poll all night; the idle guard is what "the user is present" actually means. One module-level store (`apps/admin/src/lib/presence.ts`, `usePresence()`), installed once, throttled `pointermove`. **Rejected:** the Page Visibility API alone (no idle notion); the Idle Detection API (Chrome-only, permission prompt).

- **D3 — Returning to the tab refetches regardless of the 2-minute memory, with a 30-second floor.** Editing WispHub means leaving this tab, so the return is the moment the roster or the debts most likely changed — `refetchOnWindowFocus: "always"`, gated by a floor: under 30 s since the last fetch nothing is asked, because the API's display cache would answer the same bytes (provider-latency D3). cobros-live D3's `staleTime` 2 min stays for *navigation* inside the app (Pagos → Cobros → back paints from memory); it no longer gates the return-to-tab case.

- **D4 — The heartbeat is slow, presence-gated, and backs off on failure.** While present, the query refetches every **3 minutes** (`refetchInterval`), never while hidden or idle. The floor is technical (30 s cache), the interval is product: these lists move when the ISP touches WispHub, not by the second — the Feed's 5 s is for money arriving on its own. After a failed background read the heartbeat stops (`refetchInterval` reads the query's error state) and resumes on the next presence signal or pulse; a stalled provider (one call in eight, provider-latency) is not hammered every 3 minutes by every open tab. **Rejected:** 1 min (3× the provider reads for a screen that does not change by the minute); 5 min (the old mirror's tolerance, which cobros-live D3 already refused).

- **D5 — Cobros also listens to Devolada's own pulse.** The one change to the debt list that Devolada causes itself is a payment **registered in WispHub** (`payments.paymentRegisteredAt`, set by the sweep, the queue and the manual retry). `GET /payments/pulse` answers `{ registeredAt }` = `MAX(payment_registered_at)` for the tenant — one indexed D1 read, never the provider — and Cobros polls it every **30 s** while present; when the value moves, the section invalidates itself and re-reads. The moment is *registered*, not *confirmed*: until WispHub knows, its pending list has not changed, and a refetch at confirmation would show the same debt. In observation mode nothing is ever registered, and that is right — the ISP registers by hand in WispHub, which D3 covers. Links does not poll the pulse: a payment does not change the roster. **Rejected:** `/payments/feed?limit=1` (no such parameter; the feed pages full rows); a version in the session payload (mixes concerns, and the session is read on every request already).

- **D6 — The provider cache lives in the colo, and the invalidation lives in the key (TD-014 paid).** The three display caches of provider-latency D3/D5 (pending list 30 s, roster 30 s, cash payment-method id 10 min) move from module state to the Cache API (`caches.default`), keyed per tenant on a synthetic internal origin: every request landing in the same city shares one provider read, which is the shape of a pilot ISP whose members all sit in one region. The cached body carries its own `readAt` and `expiresAt`, checked against the caller's clock — the Cache API's `max-age` evicts, our clock decides freshness, and the tests time-travel. **`cache.delete` is per data center**, so provider-latency D4 ("a registration invalidates the list at once") cannot ride a delete any more: the pending-list key carries the tenant's `MAX(payment_registered_at)` — the same number the pulse reports — so a registration in any colo is a new key in every colo, and `invalidatePendingInvoices` retires. Only successful reads are stored (scenario 10 of provider-latency holds). Each read logs `hit`/`miss` per tenant and kind: the measurement TD-014 asked for before believing the win. **Rejected:** keeping the isolate map as a first layer (two freshness rules for one fact); a KV version counter (eventually consistent — up to 60 s — worse than the TTL it would improve, and a binding); local delete + "the pilot sits in one colo" (D4 best-effort with no test that says so).

- **D7 — `readAt` is when WispHub was asked, not when the request arrived (BUG-013).** Both handlers sealed `readAt: now` even when the cache answered, so "consultado hace un momento" could be up to 30 s wrong — harmless while the label sat next to a button, load-bearing once the label is the only honesty signal (D9). The cached entry carries `readAt`; the handler forwards it. Two reads inside the window answer the **same** `readAt`, which is also how the tests tell a hit from a miss without touching the cache.

- **D8 — The Feed keeps its 5 s poll; only a hidden tab pauses it.** "Ver entrar el dinero" may live on a monitor nobody touches; the idle guard would freeze it and nobody would notice. `refetchIntervalInBackground: false` (TanStack's default, now written down on both feed queries) pauses it while the tab is hidden and nothing else. Revisited with the hit/miss log if the D1 reads ever matter.

- **D9 — Stale is shown, never dressed as fresh, and a background failure never repaints the screen as broken.** "consultado hace X min" stays in the header as the only freshness signal (it now ticks from the honest `readAt`). When a background read fails and rows exist, the rows stay, the label keeps counting, and a quiet `status` note says *Sin conexión a WispHub. Mostrando la última lectura.* — no button; the retry rides the next presence signal or pulse. `ListError` (error tone, "Reintentar") is reserved for a failure with nothing to show (list-states D1). Before this spec both screens rendered `ListError` **above** a populated list on any refetch error — reachable today through the default focus refetch. **Rejected:** hiding the label until the data is "old" (a 90-second-old list without a label reads as live, and it is not); silent failure (cobros-live D7).

## Contract

`GET /payments/pulse` — ISP session, `payments: read` (every role).

| Success | Failures |
|---|---|
| `{ registeredAt: number \| null }` — ms epoch of the tenant's latest `payment_registered_at`; `null` when nothing was ever registered | 403 `AUTHENTICATION_ERROR` (no business actor) |

Unchanged wire shapes with one meaning change: `readAt` on `GET /payment-requests` and `GET /direct-payments/links/roster` is the provider read's time (D7); inside the 30 s window it repeats.

`src/wisphub/cache.ts`: `pendingInvoicesForDisplay(businessId, wisphub, now, version)` — `version` is `pendingVersion(db, businessId)`, the `MAX(payment_registered_at)` the key carries; `rosterForDisplay` and `cashPaymentMethodId` keep their signatures. Every display read returns `{ …, readAt }`. `invalidatePendingInvoices` is gone. `resetProviderCaches()` (tests) bumps a generation prefix in the key — the Cache API cannot be enumerated, and TESTING.md rule 10 still holds.

## UI contract

`apps/admin/src/lib/presence.ts` — `usePresence()`, `liveReadOptions(present, { intervalMs })`, `HEARTBEAT_MS` 180 000, `IDLE_MS` 300 000, `PULSE_MS` 30 000, `FOCUS_FLOOR_MS` 30 000.

- **Links** (`LinksScreen.tsx`): header = title + "consultado hace X"; no button. Heartbeat + return-to-tab (D3/D4). Background failure with rows → quiet note (D9).
- **Cobros** (`CobrosScreen.tsx`): same, plus the pulse (D5). `Freshness` reads `readAt` (D7).
- **Pagos** (`FeedScreen.tsx`): unchanged behaviour, the background pause written explicitly (D8).
- es-MX: "consultado hace X min", "Sin conexión a WispHub. Mostrando la última lectura."

## Scenarios

1. Links and Cobros render no "Actualizar"; the freshness label is present (D1, D9).
2. The tab becomes visible again 31 s after the last read → one refetch; 10 s after → none (D3).
3. Present tab: after 3 min the list is re-read; hidden tab: after 3 min it is not (D2, D4).
4. A background read fails with rows on screen → rows stay, the quiet note shows, no `alert` role, no "Reintentar" (D9).
5. A background read fails with nothing on screen → `ListError` with "Reintentar" (D9, list-states D1).
6. The pulse moves (a payment got registered) → Cobros invalidates and re-reads without any interaction (D5).
7. `GET /payments/pulse` answers `null` with no registration, the latest `paymentRegisteredAt` otherwise, and ignores a confirmed-but-unregistered payment (D5).
8. Two `/payment-requests` reads inside 30 s answer the same `readAt` and cost one provider read; a payment registered between them makes the next read ask the provider again (D6, D7 — provider-latency D4 by key).
9. Two roster reads inside 30 s answer the same `readAt` (D7).
10. provider-latency scenarios 6, 7, 10 and 11b hold on the colo cache (D6).

## Definition of Done

- [x] Scenarios 1–6 automated in `apps/admin/test/presence-freshness.test.tsx` (6 tests; `links.test.tsx` / `cobros.test.tsx` adapted — Cobros' arrange now answers the pulse).
- [x] Scenarios 7–9 automated in `apps/api/test/presence-freshness.test.ts` (4 tests); scenario 10 is `provider-latency.test.ts` unchanged in its assertions, now running on the Cache API.
- [x] `pnpm -r --if-present typecheck` and `pnpm -r --if-present test` green (API 264, admin 151); `node scripts/spec-lint.mjs` clean.
- [x] Found by scenario 5 and fixed here (BUG-014): `LinksScreen` read every 503 as "conecta tu llave", so a stalled WispHub (`WISPHUB_UNAVAILABLE`, also 503) showed the integration prompt instead of the error block; the screen now reads the code.
- [x] Platform contract read against the Workers Cache API reference (2026-09-04, `cloudflare-docs` source): "Workers deployed to custom domains have access to functional cache operations" (both environments run on `api.*.devoladapago.com`; dashboard and Playground previews are no-ops); "the contents of the cache do not replicate outside of the originating data center" and "`cache.delete` only purges content of the cache in the data center that the Worker was invoked" (why D6 carries the invalidation in the key); `cache.put` throws on a non-GET key, a 206 or `Vary: *`, answers 413 when `Cache-Control` says not to cache, and "responses with `Set-Cookie` headers are never cached" — our stored `Response` is a GET-keyed 200 with `max-age` and no cookie. The reference states **no constraint on the key's hostname**, so the synthetic origin stands; the deployed check below is what turns "not forbidden" into "observed".
- [ ] Deployed check on dev with the live tenant: the `hit`/`miss` log shows colo sharing across two members' tabs (second read within 30 s logs `hit`), and the pulse-driven re-read is observed once on a real registration. This is the one box a merge to `main` (→ dev deploy, CICD.md) has to open.
- [x] The e2e keyboard walk (`tests/e2e/keyboard.spec.ts`, TD-010) no longer expects an "Actualizar" stop on Links; `.design/devolada/TASKS.md` records the retirement.
- [x] TD-014 closed in TECH_DEBT.md; BUG-013 and BUG-014 recorded in BUGS.md.
