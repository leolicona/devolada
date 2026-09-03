# Information architecture — the SaaS (pivot phase 2)

Decisions here follow the pivot spec (D1–D20) and FRONTEND.md; each surface's
detail lands in its child spec's UI Contract. Existing screens are marked
**(exists)** — they evolve, they are not rebuilt.

## Surfaces

```
app.devoladapago.com        Business dashboard (evolves from apps/admin)
app.devoladapago.com/operador   Platform operator panel (role-gated route)
link.devoladapago.com       Payer page (exists; untouched except US-R04)
api. / consta.              APIs (no UI)
```

## Shell (`app.`)

- **Workspace switcher** in the sidebar and in Cuenta's identity card (US-B02; the phone's header retired 2026-09-02, account-hub D8): current business name; a
  menu lists the user's businesses + "Crear negocio". Switching swaps the
  whole data context, no re-login. One business → the switcher renders as a
  plain label. The role reads in the sidebar and in Configuración → Equipo,
  not in the phone's header.
- **The phone's header is one row** (2026-09-02): business name left, Saldo
  chip right, 48px. Three stacked rows (name, role, chip) took a quarter of
  the screen before the page title with nothing the reader acts on daily.
  **Rejected**: no header at all with a badge on Configuración — the
  balance is the number that decides a top-up, it stays in sight; the
  saldo inside the page-title row — that row is already full at 375px.
- **Saldo chip** in the sidebar (US-B04): current credit, always visible on a monitor; on a phone the bottom bar's avatar wears the step and "Saldo bajo" is a strip the owner closes (account-hub D3, D8, D9 — 2026-09-02).
  Each step changes **label and icon, never color alone** (the brief's own
  law): normal shows icon + amount and no word ("Saldo" next to a coin and
  a figure said nothing); at 20% it gains "Saldo bajo" + its icon;
  at ≤0, "Sin saldo"; past the cap, "Validación en pausa". The US-B04 child
  spec's UI Contract states the exact set. Tapping it opens Configuración → Saldo y recargas. A chip, not a nav
  section — it is a status, not a place. **Rejected**: a sixth nav section
  (breaks the ≤5 law); burying it in settings with no ambient signal (a
  business discovers the pause when a customer complains — exactly what D6's
  warnings exist to prevent).
- **User menu**: account, passkey, sign out. Role badge shown here. *(Built 2026-09-02 as **Cuenta**, the fifth section — the avatar replaces the Configuración gear at both widths; `docs/admin/account-hub.spec.md`.)*
- Nav (≤5, one-word labels — the FRONTEND law measured at 360px):

| Section | es-MX label | Stories | Phase | Exists? |
|---|---|---|---|---|
| Payments | **Pagos** | US-R02, US-R03, US-D06 | 4 | (exists as "Cobros" feed — renamed, gains filters + proof view + class) |
| Payment requests | **Cobros** | US-R01 | 4 | new |
| Links | **Links** | US-D07 | — | (exists) |
| Integrations | **Integraciones** | US-I01–I03 | 5 | new |
| Settings | **Configuración** | US-A04, US-B03–B05, US-D05, US-D11 | 2–3 | (exists — gains pages) |

The feed's current label "Cobros" moves to the *expected* side when phase 4
lands both sections; until then the feed keeps its name (one rename, done
when the second section exists, so the two words never coexist wrongly).

**Routes are identifiers, and therefore English** (`/payments`,
`/payment-requests`, `/links`, `/settings`); the es-MX word is the label,
never the path. Written down 2026-09-01 (PR #135 review) because the router
held both conventions — `/nuevo-negocio`, `/invitaciones/:id` and
`/operador` came in Spanish during phases 2–3. Those three stay until each
screen is next touched (TD-017); no new Spanish path is added.

## Screens by section

### Onboarding (US-B01) — before the shell is useful
Wizard, one screen per step, skippable nothing: (1) business name →
(2) CLABE + bank + beneficiary — the bank is **pre-selected from the
provider vocabulary** by the CLABE's first digits and correctable only by
picking from that same catalog, never typed (direct-payment D16; a name
outside it produces the faceless `invalid` that was BUG-007 — the US-B01
child spec's UI Contract must cite both) → (3) done: the welcome bonus is announced and the first action offered is
"Comparte un link de pago". Defaults (timezone, fee payer, tolerance) are
applied silently — settings can change them later. Signup itself (email +
code) exists and is untouched.

### Pagos (phase 4)
- List (exists): rows gain the **class** (exacto / corto / excedente as
  StatusBadge variants — icon + text, never color alone) next to the
  reconnection status; filters: estado, fecha, cliente (US-R03).
- Row expansion (exists for failed charges): gains **"Ver comprobante"** —
  the CEP evidence (amount, date, banks, clave) and, for short payments, the
  two numbers and the missing pesos (partial-payment D7 voice).
- Action outcome (done / withheld / failed / observación) rendered as its own
  line with retry for operators (pivot Open item 5).

### Cobros (phase 4)
- Mirror of open payment requests (US-R01): customer, amount, source badge
  (WispHub), freshness ("actualizado hace 2 min" — a mirror admits being a
  mirror). Read-only in v1; "Crear cobro" is the deferred manual door and
  does not render.

### Links (exists)
Unchanged; already speaks the glossary.

### Integraciones (phase 5)
- Catalog page: one card per provider (WispHub today; the D17 generic
  integration card appears here when it exists).
- Detail: API key (write-only, testable — settings D1–D3 reused verbatim),
  the **class → action mapping** (three fixed rows, threshold % + floor $
  inside "corto"), the **master switch** ("Ejecutar acciones automáticamente"
  → off = modo observación, badge shown in the shell while off), and the
  provisional-release switch (pre-verdict, its own block — Open item 1).

### Configuración (exists — becomes a hub of pages)
1. **Preferencias** — timezone, time format (exists; its own page since
   settings D11, 2026-09-03).
2. **Pago directo y conciliación** — the SPEI card (CLABE, bank,
   beneficiary and the one service fee, settings D9) and the reconciliation
   policy, one page at `/settings/direct-payment` (exists). Detail in
   [INFORMATION_ARCHITECTURE-settings.md](INFORMATION_ARCHITECTURE-settings.md).
3. **Saldo y recargas** (phase 3, US-B04/B05) — balance, entry history
   (append-only list, same visual grammar as the old ledger), "Recargar":
   instructions to transfer to the platform's CLABE + proof upload → the
   same validation flow the business's own customers use. Warnings staged
   per D6.
4. **Usuarios** (phase 2, US-B03) — members with roles; invite by email.
5. **Entrar con huella o rostro** (US-S07) — the person's passkeys.

The **WispHub key** left for Integraciones when phase 5 landed, and the
policy card (phase 4, tolerance + surplus treatment, business-level per
pivot D8) rides with the SPEI channel in 2 while SPEI is the only one.

### /operador (phase 3, US-L02)
Behind `platform_operator`. One table of platform settings (fee, welcome
bonus, negative cap, defaults, retry schedule, top-up CLABE), each row
editable with its full version history (author + date). Boring on purpose.

## States that must exist everywhere new

Loading skeletons · error with retry (never a false empty) · true empty with
a next action · role-hidden (absent, not disabled) · paused-credit banners
(dashboard) and paused-link copy (pago page, D6 voice: the business's fault,
never the payer's).
