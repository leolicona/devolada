# Feature Specification: payment-method-per-channel

**Feature Branch**: `claude/spec-019-devolada-as-collector` (the directory was
`019-devolada-as-collector` until the feature moved from a user to payment
methods, the same day)

**Created**: 2026-10-01 · **Rewritten**: 2026-10-01 · **Revised**: 2026-10-02

**Status**: Planned and tasked — no clarification open, nothing left to
measure (R1–R13). Revised after the first plan (2026-10-02): the methods
are a requirement for turning on automatic execution (FR-013), the
business copies a description with each name, and a method Devolada has
seen is used by the next payment (FR-014). Revised again after
`/speckit-analyze` (2026-10-02): execution needs a saved connection
(FR-013). [plan.md](plan.md) and [tasks.md](tasks.md) carry all of it;
next is `/speckit-implement`.

**Input**: User description, in the creator's words (2026-10-01): "Para el
piloto mi cliente quiere que registremos los pagos en wisphub a nombre de
devolada pago para que pueda descargar la lista de facturas pagadas a
través del link de pago." After the measurements below: "Me parece
inviable crear muchos usuarios con permisos de administrador para cada
tienda", and then "Sí, reescribe la spec 019 con formas de pago". On
2026-10-02: "devoladapago determina el nombre y descripción de la forma de
pago: ejemplo 1: SPEI - LINK DEVOLADAPAGO. Ejemplo 2: EFECTIVO - RED
DEVOLADAPAGO. Este incremento va a nivel de adaptador, en este caso, del
adaptador wisphub." The same day, the final names: "El nombre exacto como
lo registres es SPEI - LINK.DEVOLADAPAGO y CASH - RED.DEVOLADAPAGO, me
parecen mas adecuados."

## Where this comes from

When a payment is confirmed, Devolada records it in the business's system
through the integration. Today it records every payment the same way: with
the business's own cash payment method. That holds for SPEI and for cash
at a store (spec 018), and for every way a payment gets there: the
verdict, "Ejecutar ahora", a retry from the queue, a partial payment. In
the pilot's system, Devolada's payments therefore look exactly like the
cash the business collects at its counter. The business cannot list "what
came in through Devolada", so it cannot reconcile Devolada against its
bank, nor the network's cash against what the stores handed over.

The pilot first asked for Devolada's payments to appear under a user of
its system created for Devolada (`DEVOLADAPAGO`). Measured on the
provider's demo on 2026-10-01 (R1–R3 below), that route does not work:
Devolada cannot name the user a payment is recorded under, in every case
seen the user was the owner of the key, and the business may not be able
to get a key for a new user on its own.

What does work (R4–R7): the payment method is chosen with every payment,
the business's system keeps it, and its list of paid invoices filters by
it. On 2026-10-01 the spec had the business create its own methods and
choose them in Devolada, one for SPEI and one per store. On 2026-10-02 the
creator simplified it: **Devolada names the methods**, one per channel, and
the whole increment lives in the adapter.

So this feature keeps one promise: **every payment Devolada records in a
business's system carries the payment method Devolada named for where the
money came in — `SPEI - LINK.DEVOLADAPAGO` for SPEI, `CASH - RED.DEVOLADAPAGO` for cash at the network's stores — whenever the business has
created it, and a reference that ties it back to Devolada.** The business
filters its own system by that method and downloads the list.

## The words

- **Payment method**: the label a business's system puts on a recorded
  payment to say how the money came in ("Efectivo", "Transferencia"). It is
  the core's word; the provider's own word for it belongs to the adapter.
- **Channel**: where a payment came in. Two today: **SPEI** (the payment
  link, and every other SPEI confirmation) and **the store network** (cash
  at any store, spec 018). The core already records it on every payment.
- **Devolada's methods**: the two payment methods Devolada names, one per
  channel. The names belong to the adapter that records the payment; for
  the WispHub adapter they are `SPEI - LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO`. The business creates each one, once, in its own
  system (R6).
- **The cash method**: the method Devolada uses today for every payment,
  found in the business's system the way it is found today. It stays the
  fallback.
- **Fallback**: recording a payment with the cash method because the
  business's system has no method with Devolada's name for that channel.
- **Reference**: a short free text the business's system keeps on a
  recorded payment.

## What was measured (2026-10-01 and 2026-10-02)

On the provider's demo tenant, with payments recorded as "only register"
(no router touched): $1 test invoices on 2026-10-01, and on 2026-10-02 the
demo's own pending invoices, paid by their total ($3), as Devolada pays
them. The details belong to the adapter (constitution IX); they are
recorded here because they decided the feature, so nobody needs to run
them again. The 2026-10-02 run is the Postman collection "WispHub · Formas
de pago de Devolada (ESCRIBE)".

| # | Question | Answer |
| --- | --- | --- |
| R1 | Can Devolada name the user a payment is recorded under? | No. A payment accepts five values: payment method, action, date, amount and reference (a validation probe of 74 field names, and the provider's own documentation). Six real payments named another user — by id, by username and as an object, an administrator and a cashier, at invoice creation and at payment — and all six landed under the owner of the key. An invoice's user is read-only, at creation and on edit. |
| R2 | Can Devolada create users in the business's system? | No. The list of users is read-only. |
| R3 | Under which user does a payment appear? | The owner of the key that recorded it, in every case seen. A user with the cashier role cannot generate a key, and a new administrator did not see the option either. Not proven with a second key. |
| R4 | Can Devolada choose the payment method of each payment? | Yes. A payment recorded as a bank transfer, with the same key, kept that method. |
| R5 | Does the business's system filter paid invoices by payment method? | Yes, through the provider's documented list filter. It returned exactly that payment; the cash method returned the other 36. It combines with the filter by user. |
| R6 | Can Devolada create payment methods? | No. The list is read-only: the business creates them. |
| R7 | Does the system keep a reference on a payment? | Yes. Free text up to 200 characters, kept on the invoice and returned when it is read. It is not a filter of the list. |
| R8 (M4) | Does the system keep a method's name exactly as typed, and does a method have a description? | The name, yes: `SPEI - LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO`, created in the panel, came back character for character. A description, not through the API: the list gives each method only an id and a name, its documentation lists no field, and there is no route for one method (404). |
| R9 (M1) | What does the system answer when a payment names a method that does not exist? | HTTP 400 naming the field: `forma_pago`, "Clave primaria … inválida - objeto no existe". The invoice stays pending: nothing is recorded, so the adapter can fall back at once. A method deleted in the panel (M1b) was not measured; since the adapter finds methods by name in the current list, a deleted method stops being used as soon as the list is read again. |
| R10 | Do Devolada's two methods and the reference survive a real payment? | Yes. Demo invoices #1 and #2, paid by their total, kept `SPEI - LINK.DEVOLADAPAGO` and `CASH - RED.DEVOLADAPAGO` and the reference character for character, the middle dot included (`DV-PRUEBA1 · MBAN01002610020000001`). The list filter by each method found its invoice; the filter by the cash method found neither. |
| R11 | Does today's rule for the cash method take one of Devolada's methods? | **Yes, on the demo itself.** The system lists `CASH - RED.DEVOLADAPAGO` before "Cash" and "efectivo", so today's adapter, which takes the first name that says "efect" or "cash", records every payment with it. FR-012 is not hypothetical. |
| R12 (M3) | Does the system's own screen show the method and the reference on a paid invoice? | Yes. The invoice in the provider's panel, and its PDF, list under *Transacciones* "Forma de Pago: SPEI - LINK.DEVOLADAPAGO - Referencia: DV-PRUEBA1 · MBAN01002610020000001" (invoice #1) and the same for `CASH - RED.DEVOLADAPAGO` and the store's name (invoice #2), middle dot included. Checked by the creator, 2026-10-02. |
| R13 (M2) | Does the system's own screen filter paid invoices by payment method, and does its download carry the method and the reference? | The filter, yes: the panel's invoice list, filtered by "Fecha de Pago" over October, "Pagada" and the method `SPEI - LINK.DEVOLADAPAGO`, showed invoice #1 alone (total $3.00); #2 (network) and #3 (cash) did not appear. The list shows a *Forma de Pago* column and offers copy, Excel and PDF downloads, plus a PDF report with a summary by payment method. The download carries the method: the list's CSV, downloaded with that filter, has one row — invoice #1, *Fecha Pago* `02/10/2026 09:50`, *Total Cobrado* `3.00`, *Forma de Pago* `SPEI - LINK.DEVOLADAPAGO` — under the columns #Factura, Cajero, Usuario, Cliente, Fecha Pago, Estado, Zona, Total Cobrado, Forma de Pago, Total. Its *Cajero* is empty for this payment, recorded through the API. The download follows the visible columns: with *Sub*, *Des* and *Saldo* turned on, a second CSV carried them. The column chooser ("Tabla", which opens *Ajustes → Columnas Visibles*) does not offer the reference, so neither the list nor its download can carry it. The reference is read on the invoice itself and its PDF (R12). Checked by the creator, 2026-10-02. |

## What must be measured before the plan

Nothing. M1 to M4 were answered on 2026-10-02: M1 by R9, M2 by R13, M3 by
R12, M4 by R8. The last open fact closed the same day: the panel's list
cannot show the reference as a column, so its download does not carry it
(R13). The business filters, counts and downloads by the method
(SC-002, SC-003), and reads the reference on each invoice (US3).

## Clarifications

### Session 2026-10-01

- Q: How should Devolada's payments be told apart in the business's system?
  → A: First, under a user the business created for Devolada
  (`DEVOLADAPAGO`). **Replaced the same day** by payment methods, after
  R1–R3: "Sí, reescribe la spec 019 con formas de pago".
- Q: Cash at stores — one payment method for all stores, one per store, or
  the same as SPEI? → A: One per store. **Replaced on 2026-10-02** by one
  method for the whole network (below).
- Q: What does Devolada write in the reference? → A: The payment's DV-
  folio on every payment; for SPEI, also the clave de rastreo when
  Devolada knows it; for store cash, also the store's name.
- Q: When the method no longer exists in the business's system, does
  Devolada record the payment with the cash method so the action never
  waits, or keep it in the queue until the business fixes it? → A:
  **Record with the cash method.** Kept on 2026-10-02; the warning moved to
  the integration's own screen (below).

### Session 2026-10-02

- Q: Who names the payment methods? → A: **Devolada.** `SPEI -
  LINK.DEVOLADAPAGO` for SPEI, `CASH - RED.DEVOLADAPAGO` for cash at the
  network's stores (the creator's final names; the first example read
  `SPEI - LINK DEVOLADAPAGO` and `EFECTIVO - RED DEVOLADAPAGO`). This
  replaces the business choosing from its list in Devolada. The business
  still creates each method once in its own system, with that name,
  because Devolada cannot (R6).
- Q: The network's name says "CASH", and today the adapter takes as the
  cash method the first method whose name says "efect" or "cash". Could it
  take `CASH - RED.DEVOLADAPAGO` instead of the business's own cash
  method? → A: **Yes.** Read in the adapter, then measured the same day on
  the demo, where the system lists `CASH - RED.DEVOLADAPAGO` even before
  "Cash" (R11). So the cash method must never be one of Devolada's methods
  (FR-012), and no business creates `CASH - RED.DEVOLADAPAGO` before this
  feature ships.
- Q: One method per store, or one for the network? → A: **One for the
  whole network**, from the creator's example. The per-store detail is not
  lost: the reference carries the store's name (US3), and Puntos de pago
  keeps the cash per store. This also removes the cost accepted on
  2026-10-01 (one method by hand per store, one more for every new store).
- Q: Where does the increment live? → A: **In the adapter**, the WispHub
  adapter for now. The adapter names the methods, finds them, falls back
  and writes the reference. The core only hands it what the payment
  already knows. There is no choice screen in the core, no new table and
  no mark in Pagos.
- Q: Should the methods be a requirement before the business can collect?
  What happens while not even one exists? → A: **A requirement for
  turning on automatic execution, not for collecting** (the creator,
  choosing the recommended option). The integration's screen reads in
  order: the connection, then the payment methods, then execution. From
  the connection on, the business collects in observation mode: payers
  pay, Devolada validates, nothing is written in its system, and a payment
  run by hand records with the method that exists at that moment.
  Automatic execution turns on only when the method of each of the
  business's channels exists (FR-013). Collecting never waits on a method,
  and Devolada never turns execution off: a business already executing,
  or a method that disappears later, falls back to cash (FR-004) with the
  step shown as pending. Without the requirement, a business that turns
  execution on first would record its first payments as cash, and FR-006
  keeps them there.
- Q: What does the business copy? → A: **The name and a description**,
  both ready to copy. SPEI: «Pagos SPEI validados por link de Devolada
  (bancos, Spin, Mercado Pago, CoDi, DiMo). Los registra Devolada; no usar
  en mostrador.» Network: «Pagos en efectivo en tiendas de la red
  Devolada. Los registra Devolada; no usar en mostrador.» (the creator:
  "sería prudente mencionar algo como Pagos SPEI validados por link
  devolada", then naming the apps). Devolada checks the name only: the
  system's API returns no description (R8).
- Q: Does "SPEI" cover Spin, the apps and transfers within one bank, or
  do those need methods of their own? → A: **One SPEI method; no new
  methods, no new name.** Devolada confirms a SPEI payment only with
  Banxico's record of it (the CEP), so everything it records in this
  channel is SPEI: Spin by OXXO, Mercado Pago, Nu and the other apps are
  SPEI participants (they are in Devolada's bank list), and CoDi and DiMo
  travel over SPEI. A transfer within one bank, or a cash deposit to the
  business's account, never runs through SPEI: Devolada cannot confirm it
  today, so it never records it. The description names the apps so the
  business's staff reads them as SPEI.
- Q: Devolada keeps the list of a business's methods for up to ten
  minutes, in each place it runs, so a method just created may be ignored
  for that long, and those payments stay as cash (FR-006). Accept the
  wait, make it exact, or drop the memory? → A: **Exact once Devolada has
  seen it** (the creator, choosing the recommended option): as soon as the
  integration's screen, "Probar conexión" or turning on execution shows a
  method found, the next payment uses it, wherever Devolada runs it
  (FR-014). A business that never opens the screen waits at most ten
  minutes, as today. Dropping the memory was rejected: every payment would
  wait on the business's system.
- Q (from `/speckit-analyze`): can execution be turned on before the
  business connects its system? → A: **No.** Without a saved connection
  there is nothing to check, so execution stays off (FR-013). Otherwise a
  business that turned execution on first and connected afterwards would
  skip the requirement. Integrations already executing without a key are
  left as they are.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The business downloads what came in by SPEI (Priority: P1)

The owner creates, once, a payment method called `SPEI - LINK.DEVOLADAPAGO` in their own system. From then on, every SPEI payment
Devolada records carries that method; nothing has to be chosen in
Devolada. In their own system, the owner filters the paid invoices by that
method and a date range, and downloads the list. Every SPEI payment
Devolada recorded in that range is in it, and nothing collected at the
counter is.

**Why this priority**: It is the pilot's whole request. Without it, the
business cannot tell Devolada's payments from its counter's, and it cannot
reconcile either.

**Independent Test**: On the demo tenant, create `SPEI - LINK.DEVOLADAPAGO`. Pay two links by SPEI, and collect one invoice at the
counter with the cash method. Filter the paid invoices by the new method:
the two links' invoices are there and the counter's is not.

**Acceptance Scenarios**:

1. **Given** a business whose system has `SPEI - LINK.DEVOLADAPAGO`,
   **When** a payer pays a link and Devolada records the payment, **Then**
   the business's system shows that method on the payment.
2. **Given** the same business, **When** a payment is recorded and leaves
   the service cut in place (a partial payment), **Then** it carries the
   method too.
3. **Given** a payment whose recording waited in the queue because the
   system was down, **When** a retry or "Ejecutar ahora" records it,
   **Then** it carries the method if it exists at that moment.
4. **Given** payments recorded before the business created the method,
   **When** the business filters by it, **Then** those payments are not in
   the list. Devolada never edits a payment already recorded (FR-006).
5. **Given** a business whose system has no method with that name (never
   created, renamed or deleted), **When** an SPEI payment is confirmed,
   **Then** Devolada records it with the cash method, exactly as today,
   and the action runs without waiting.
6. **Given** the business typed the name with different capitals or
   spaces around the dash, **When** a payment is recorded, **Then** the
   method is still found, with the tolerance of FR-003.

---

### User Story 2 - The network's cash under its own method (Priority: P2)

For a business with the store channel on, the owner creates, once, a
payment method called `CASH - RED.DEVOLADAPAGO`. Every cash payment any
store of the network records for the business carries that method. The
owner filters by it to see all the network's cash in their system, and
checks it against the hand-overs in Puntos de pago. The store of each
payment is in its reference (US3).

**Why this priority**: SPEI is the pilot's request and the larger flow.
The store channel is newer (spec 018).

**Independent Test**: On the demo tenant, create `CASH - RED.DEVOLADAPAGO`, and record one cash payment at each of two stores. Filter by
the method: both invoices are there, neither appears under the SPEI
method, and each reference names its own store.

**Acceptance Scenarios**:

1. **Given** a business whose system has `CASH - RED.DEVOLADAPAGO`,
   **When** any store records a cash payment for it, **Then** the
   business's system shows that method on the payment.
2. **Given** a business whose system does not have it, **When** a store
   records a cash payment, **Then** Devolada records it with the cash
   method, exactly as today, and the action runs without waiting.
3. **Given** a business that created only `SPEI - LINK.DEVOLADAPAGO`,
   **When** a store records a cash payment, **Then** it is recorded with
   the cash method; the two channels are independent.
4. **Given** a business whose store channel is off, **When** a member opens
   the integration's screen, **Then** the network's method is not
   mentioned.

---

### User Story 3 - Each recorded payment says where it came from (Priority: P3)

The owner opens a paid invoice in their system and reads its reference:
Devolada's folio, and for SPEI the clave de rastreo, or for store cash the
store's name. With the folio they find the payment in Devolada's Pagos;
with the clave, the matching line in their bank statement; with the
store's name, which store holds the cash.

**Why this priority**: It adds detail to the reconciliation. The lists of
US1 and US2 work without it.

**Independent Test**: On the demo tenant, pay one link by SPEI and record
one cash payment at a store. Read both invoices: the SPEI one carries the
folio and the clave de rastreo; the store one carries the folio and the
store's name.

**Acceptance Scenarios**:

1. **Given** an SPEI payment whose clave de rastreo Devolada knows,
   **When** Devolada records it, **Then** its reference carries the folio
   and the clave de rastreo.
2. **Given** an SPEI payment whose clave de rastreo Devolada does not know,
   **When** Devolada records it, **Then** its reference carries the folio
   alone.
3. **Given** a store cash payment, **When** Devolada records it, **Then**
   its reference carries the folio and the store's name as it was at that
   moment.
4. **Given** a store whose name is long, **When** the reference would pass
   the system's limit, **Then** the store's name is shortened; the folio
   and the clave de rastreo are never cut.
5. **Given** a payment that falls back to the cash method, **When**
   Devolada records it, **Then** it still carries its reference.

---

### User Story 4 - The business sets up its methods before Devolada writes in its system (Priority: P2)

On the integration's own screen, after the connection and before
execution, the owner sees Devolada's method names for their channels, each
with its description, both ready to copy; whether each exists in their
system; and what happens while one is missing. "Probar conexión" says the
same. The owner creates the methods and the screen shows them found.
Automatic execution turns on only then (FR-013); until then the business
collects in observation mode.

**Why this priority**: Without it, a typo in the name sends every payment
back to the cash method in silence (constitution VIII), and a business
that turns execution on before creating the methods records its first
payments as cash for good (FR-006). It makes US1 and US2 true from a
business's first payment. Raised from P3 on 2026-10-02, when the methods
became a requirement for execution.

**Independent Test**: On the demo tenant, in observation mode, open the
screen before creating the methods: both show as missing, with the names
and descriptions to copy, and execution does not turn on. Create one, run
the test: it shows found, the other still missing; with the store channel
off, execution now turns on, and the next SPEI payment carries the
method.

**Acceptance Scenarios**:

1. **Given** a business with neither method, **When** the owner opens the
   integration's screen, **Then** it shows both names as not created yet,
   as setup steps, not as an error.
2. **Given** a business with the store channel off, **When** the owner
   opens the screen, **Then** only the SPEI name is shown.
3. **Given** the business's system cannot be reached, **When** the owner
   opens the screen, **Then** it says the methods could not be checked; it
   never shows them as missing.
4. **Given** a method was created, **When** the owner runs "Probar
   conexión", **Then** it reports that method as found.
5. **Given** a business in observation mode without the SPEI method,
   **When** the owner turns on automatic execution, **Then** it stays off
   and the screen points at the method to create.
6. **Given** the SPEI method exists and the store channel is off, **When**
   the owner turns on automatic execution, **Then** it turns on.
7. **Given** the store channel is on and only the SPEI method exists,
   **When** the owner turns on automatic execution, **Then** it stays off:
   the network's method is missing.
8. **Given** the business's system cannot be reached, **When** the owner
   turns on automatic execution, **Then** it stays off and the screen says
   the methods could not be checked, with a way to retry.
9. **Given** a business whose execution was already on when this feature
   shipped, without the methods, **When** a payment is recorded, **Then**
   execution stays on, the payment is recorded as cash as today, and the
   screen shows the step as pending.
10. **Given** the owner is creating a method in their system, **When** they
    use the screen, **Then** they can copy the exact name and the
    description, each with one action.
11. **Given** a business that has not saved its connection, **When** the
    owner turns on automatic execution, **Then** it stays off and the
    screen asks to connect first.
12. **Given** the owner just created a method and the screen shows it
    found, **When** the next payment of that channel is recorded,
    **Then** it carries the method, wherever Devolada records it.

---

### Edge Cases

- **A business that never creates the methods** collects in observation
  mode and cannot turn on automatic execution (FR-013). If its execution
  was already on when this feature shipped, it stays on, and its payments
  are recorded with the cash method, as today. The integration's screen
  shows the setup step (US4).
- **The platform operator switches the store channel on** for a business
  whose execution is already on. Execution stays on; the network's
  payments fall back to cash until the business creates
  `CASH - RED.DEVOLADAPAGO`, and the screen shows the step.
- **Turning execution off** is always possible, whatever the methods.
- **Execution turned on before connecting** is refused: connect first
  (FR-013). An integration already executing without a key when this
  feature ships keeps its switch; once it saves a key, its payments fall
  back until the methods exist, and the screen shows the step.
- **A method created while payments are coming in.** Until Devolada sees
  it — the screen, the test, turning on execution, or its own list read —
  a payment may still be recorded with the cash method, at most ten
  minutes after the method was created. Once seen, the next payment uses
  it (FR-014).
- **A business creates the methods before this feature ships.** Today's
  adapter does not know them: `SPEI - LINK.DEVOLADAPAGO` is ignored, but
  `CASH - RED.DEVOLADAPAGO` may be taken as the cash method for every
  payment, SPEI included (Clarifications 2026-10-02). The setup
  instructions reach a business only with the release that carries
  FR-012.
- **Someone at the counter uses one of Devolada's methods by hand.** Those
  payments appear in the list too, and Devolada cannot tell them apart.
  The screen asks the business to use these methods only for Devolada
  (FR-008).
- **Two methods with the same name** in the business's system. Devolada
  uses one of them, always the same one, and the screen says there are
  two. For FR-013 the method exists.
- **The business renames or deletes a method.** From the next payment, that
  channel falls back to the cash method; the screen shows it as missing.
  Execution stays on. Payments already recorded keep their method
  (FR-006).
- **The business connects another account of its system** (a new key or a
  new address). Nothing to redo in Devolada: the methods are found by name
  in the new account, and the next payment reads the new account's list,
  never the old one's (FR-014). If they do not exist there, payments fall
  back until the business creates them.
- **A store collects for two businesses.** Each business has its own
  `CASH - RED.DEVOLADAPAGO` in its own system. A method is never
  shared between businesses.
- **A payment that needs an invoice Devolada creates to carry it** (the
  customer owes only a carried balance). The payment carries the method
  and the reference like any other.
- **The amount in the list** is the amount Devolada records today: the debt
  the payment settled, without Devolada's fee. This feature does not
  change it.
- **A business in observation mode** records nothing in its system.
  Unchanged. A payment it runs by hand ("Ejecutar ahora") is recorded
  then, with the method that exists at that moment.
- **A business with no integration, or whose integration has no payment
  methods,** gets nothing of this; its payments are recorded, if at all,
  as today (constitution IX).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every SPEI payment Devolada records in the business's system
  MUST carry the method named `SPEI - LINK.DEVOLADAPAGO`, when the
  business's system has it.
- **FR-002**: Every store cash payment Devolada records in the business's
  system MUST carry the method named `CASH - RED.DEVOLADAPAGO`, when the
  business's system has it, whichever store recorded it.
- **FR-003**: Each method MUST be found by its name in the business's
  system, read from that system, never by an identity remembered from
  another account. The system keeps a name as typed (R8); the match MUST
  still forgive capitals, accents and the spaces around the dash and the
  dot, because the business types the name by hand. When two methods
  match, the same one MUST be used every time.
- **FR-004**: When the business's system has no method with the channel's
  name, or the method disappears before the payment is recorded (the
  system then refuses the payment and records nothing, R9),
  Devolada MUST record the payment with the cash method, exactly as today.
  The action MUST NOT wait. The two channels are independent.
- **FR-005**: FR-001 to FR-004 hold for every way a payment gets recorded:
  the verdict, "Ejecutar ahora", a retry from the queue, a partial payment,
  and a payment carried by an invoice Devolada creates. The method is
  decided at the moment the payment is recorded.
- **FR-006**: Devolada MUST NOT change, move or record again a payment
  already recorded in the business's system. Payments recorded before a
  method existed keep the cash method.
- **FR-007**: When the integration can attach a reference to a recorded
  payment, every payment Devolada records MUST carry one, whether or not
  it fell back. It starts with the payment's folio. For SPEI it adds the
  clave de rastreo when Devolada knows it; for store cash it adds the
  store's name. It MUST NOT carry the payer's name, phone or account. It
  MUST fit the system's limit, and only the store's name may be shortened
  to fit.
- **FR-008**: The integration's own screen MUST show, after the connection
  and before execution, Devolada's method names for the channels the
  business has (SPEI always; the network's only when the store channel is
  on), each with Devolada's description, each ready to copy; whether each
  exists in the business's system; and what happens while one is missing.
  It MUST tell the business, in es-MX product copy, to create them with
  those exact names and never use them for payments taken at the counter.
  A missing method MUST read as a setup step, not as an error.
- **FR-009**: "Probar conexión" MUST report, for each of those names,
  whether the method exists. When the business's system cannot be reached,
  the screen and the test MUST say the methods could not be checked, never
  that they are missing (constitution VIII).
- **FR-010**: Devolada MUST NOT create, edit or delete payment methods in
  the business's system. The business owns them (R6).
- **FR-011**: The increment MUST live in the adapter (constitution IX). The
  names, the match, the fallback and the writing of the reference belong
  to the adapter of the business's system. The core MUST only hand the
  adapter what the payment already knows — its channel, folio, clave de
  rastreo and store name — through the capability that already records
  payments. The core adds no choice, no table and no screen of its own,
  and an adapter whose system has no payment methods ignores what it
  does not use.
- **FR-012**: The cash method — the fallback, and the method every payment
  carries while no Devolada method exists — MUST never be a method that
  matches one of Devolada's names (FR-003), whatever those names say and
  in whatever order the business's system lists its methods (R11). Only
  Devolada's two names are set aside: a business's own method that merely
  mentions Devolada is not. A business that has only Devolada's methods
  and no cash method of its own MUST keep the behaviour it has today for
  that case.
- **FR-013**: Turning on the integration's automatic execution MUST
  require that the method of each of the business's channels exists in
  the business's system (SPEI always; the network's when the store channel
  is on), read from that system at that moment. Two methods with one name
  count as one that exists. When the system cannot be reached, execution
  MUST stay off and the screen MUST say the methods could not be checked.
  The requirement holds only when turning execution on: turning it off is
  always allowed, and Devolada MUST NOT turn off an execution that is on —
  not at the release, not when a method disappears, not when the store
  channel is switched on later; those payments fall back (FR-004).
  Turning execution on also requires a saved connection: without one,
  execution MUST stay off. Collecting — links, validation, observation
  mode, running a payment by hand — MUST NOT depend on the methods.
- **FR-014**: Once the integration's screen, "Probar conexión" for the
  saved connection, or turning on execution has read the business's
  methods, the next payment Devolada records for that business MUST use
  what that read found, wherever Devolada runs it. Saving a new connection
  (another key or another address) counts the same: the next payment MUST
  read the new account's methods, never the old one's. Without such a
  read, a method created in the business's system MUST be used within ten
  minutes of its creation.

### Key Entities

No new entity. The feature reads what exists, and remembers one moment
on the integration: when Devolada last saw the business's methods
(FR-014).

- **Recorded payment** (exists, spec 018 and before): it already carries
  its channel, its folio and, for SPEI, its clave de rastreo when known.
- **Store** (exists, spec 018): its name feeds the reference.
- **Devolada's methods** (in the business's system, not in Devolada): the
  two payment methods the business creates with Devolada's names.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the moment the integration's screen shows
  `SPEI - LINK.DEVOLADAPAGO` found (or, without opening it, ten minutes
  after the business creates it), 100% of the SPEI payments Devolada
  records carry it, checked on the pilot's first 30 payments after that.
- **SC-002**: For any month after that, the number of paid invoices in the
  business's own download, filtered by `SPEI - LINK.DEVOLADAPAGO`, equals
  the number of SPEI payments Devolada's Pagos shows as recorded in the
  business's system in that month: zero missing, zero extra.
- **SC-003**: The owner gets that download in under 2 minutes with their
  system's own filter, without asking Devolada for anything.
- **SC-004**: Setting up takes the business under 5 minutes: copying the
  name and description of one or two methods, creating them in its own
  system and seeing them found on the integration's screen, with nothing
  from Devolada's team and nothing to choose in Devolada.
- **SC-005**: No action waits because of a payment method: zero payments
  queued for a missing method.
- **SC-006**: For any period, the cash recorded under `CASH - RED.DEVOLADAPAGO` in the business's system equals the store cash Devolada's
  Pagos shows for that business in the same period; per store, the
  references add up to each store's cash.
- **SC-007**: Every business that turns on automatic execution after this
  feature ships has the methods of its channels at that moment: zero
  turned on without them.

## Assumptions

- **The names are Devolada's**, and fixed: the business types them, it
  does not choose them. Another adapter may name its methods differently;
  that is its own decision.
- **One method for the whole network** is the creator's decision of
  2026-10-02. One method per store is out of scope; the reference and
  Puntos de pago carry the per-store detail.
- **"Descripción"**: Devolada determines the name and the description of
  each method (the creator, 2026-10-02), and the screen gives both to
  copy (FR-008). The business types the description in its system's panel
  when it creates the method; the API returns none (R8), so Devolada
  never checks it, and a different description changes nothing.
- **The cash method stays found as today, minus Devolada's names** (FR-012).
  It is still the first name that says "efect" or "cash" in the order the
  business's system lists them, so a business with several such methods
  keeps the one it has today.
- **Every SPEI confirmation is the SPEI channel**, whether the payer used
  the link with its reference, without it, or confirmed later: one method.
- **The SPEI method carries only payments Banxico confirmed.** A transfer
  within one bank or a cash deposit has no Banxico record; Devolada does
  not confirm them today (receipt-reader-tuning D5 leaves them out of
  scope), so they are never recorded. If Devolada ever confirms such a
  payment another way, it gets a method of its own, decided in its own
  spec, and is never recorded as SPEI.
- **The reference is written once**, at recording. A store renamed later
  does not change payments already recorded (FR-006).
- **Store names are told apart by the operator, not by the system**
  (the creator, 2026-10-02). The reference carries the store's name as
  Devolada's operator set it; two stores may share a name today, and
  SC-006's per-store sum then needs Pagos, where the folio tells them
  apart. For the pilot the operator gives each store a distinct name
  (e.g. "Abarrotes Lupita – Centro"). Making the system refuse a repeated
  name belongs to store registration (spec 018), not to this feature.
- **No mark in Pagos.** A payment that fell back is not marked one by one:
  the reason is a setup state of the business, and the integration's
  screen shows it (US4). A per-payment mark would need the core and is out
  of this increment.
- **The download is the business's own tool.** This feature adds no
  download to Devolada's panel.
- **A business that issues electronic invoices from its system** may see
  its SPEI payments change from cash to the new method. That is the
  business's own setup, and arguably more correct; this feature does not
  measure it.
- **The amount and the date Devolada sends may be ignored in silence.**
  The provider's documentation says the system ignores both when the
  key's user lacks two rights. That is true today, before this feature,
  and unmeasured with a limited user. It deserves its own look; this
  feature does not change it.
- **The route of a user for Devolada is out of scope.** R1–R3 stay in this
  record. If a business one day wants its own user as well, that is a
  separate feature, and it needs a key for that user.
- **Out of scope**: moving or relabelling payments recorded before the
  methods existed; creating the business's methods for it; a method per
  store; a download in Devolada's panel; a per-payment mark in Pagos.

## Dependencies

- **Spec 018 (cash at stores)**: the store channel, the stores' names and
  Puntos de pago. US2 needs it; US1 does not.
- **The integrations hub's execution switch and observation mode**
  (`integrations-hub` D4): new integrations are born observing and the
  business turns execution on. FR-013 adds its condition to that switch;
  the switch itself is unchanged.
- **Debt `core-reads-provider-directly`**: its action half is paid (spec
  018 D9, 2026-10-01): every way a payment is recorded already goes through
  the integration's action capability, and only the adapter talks to the
  provider. This feature keeps it that way: it widens what the core hands
  that capability with the payment's channel and reference data, in the
  core's words, and adds no other call. The debt's read half is untouched.
