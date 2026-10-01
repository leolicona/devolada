# Quickstart: Cash at Stores

How to prove the feature works, in four parts:
1. the measurements the design waits on;
2. the bug that must land first;
3. the automated checks;
4. a walk through the pilot on `dev`.

Shapes live in [data-model.md](./data-model.md) and
[contracts/](./contracts/); this page does not repeat them.

## 0. Measure first (before any code that depends on it)

Write each result in research.md under its decision, with the date.

| # | How | What to record | Decides |
| --- | --- | --- | --- |
| M1 | Locally: add `username()` to `better.ts`, then `pnpm --filter @devolada/api db:generate` and `db:migrate:local`. With the API up, check four things. (a) `POST /auth/sign-up/email` with a `username` is refused by the `hooks.before`. (b) A user whose `username` was written in the DB signs in with `POST /auth/sign-in/username`. (c) The same user, unverified, gets `EMAIL_NOT_VERIFIED`. (d) `POST /auth/update-user {username}` is refused. | the generated columns; the four answers | D3, D5 |
| M2 | Deploy a manifest-only build of `apps/red` to a dev preview. On an Android phone (Chrome) and an iPhone (Safari), try *Agregar a pantalla de inicio* | whether it installs; whether it opens without browser bars | D26 |
| M3 | On the pilot tenant, read only, in Postman: `GET /clientes/?nombre__contains=<three letters>&limit=5`, then `GET /clientes/?usuario=<one usuario>` | whether `zona` (or its equivalent) and `telefono` are present on both | D8 |

**If M1 fails** (the username cannot be kept to the acceptance route),
**stop** and take it to the creator. The fallback, signing in by email,
reverses one of their decisions. **If M2 fails on one platform**, the app
still works in the browser. Record it, and tell the creator before the
pilot starts.

## 1. The bug first: `queue-retry-forgets-action` (research D10)

```sh
# lite path, before research D9's capability work lands
/speckit-bug-assess   # the sweep and retryAction retry with reconnect whatever the row decided
/speckit-bug-fix
/speckit-bug-test
```

The regression test is two cases:
- a `withheld` SPEI payment whose first attempt met a 503;
- a `register_only` one.

The sweep retries each of them as register-only, and the customer stays
disconnected. It cites `bug: queue-retry-forgets-action`.

## 2. Automated checks (the CI order)

```sh
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs            # now also reads apps/red/src
node scripts/pending-lint.mjs             # now also reads apps/red/src; every "…ando…" sits in <Pending>
pnpm -r --if-present typecheck            # includes apps/red
pnpm --filter @devolada/api test -- test/cash-at-stores
pnpm --filter @devolada/api test          # every SPEI suite still passes after D9, D12, D13
pnpm --filter @devolada/red test
pnpm --filter @devolada/admin test
pnpm e2e                                  # red's screens and Puntos de pago: contrast in both themes, 360/768/1280, touch targets
pnpm e2e:passkey                          # one case on red's origin
```

The API suite must show, among the cases research D28 lists:

- **US1**:
  - a whole payment is `exact` and `confirmed`, and is registered and
    reconnected;
  - a short payment under the threshold is `short` and `partial`, and is
    registered without reconnecting. After a 503 on the first attempt,
    the sweep's retry still does not reconnect (D10);
  - a debt that changed gives `AMOUNT_CHANGED`, and nothing is written;
  - the same `collectionKey` twice gives one row and a 200;
  - with the credit paused (balance below the negative cap), the payment
    is recorded and the fee is debited (FR-029);
  - observation mode gives `observation`;
  - a cash payment on a link with an earlier `invalid` SPEI row leaves
    that row's fee alone (D12).
- **US2**:
  - the switch refuses a business without the three capabilities, and a
    second business;
  - suspending a store ends its session on the next request;
  - a correction moves the store's balance on both sides.
- **US3**:
  - acceptance; a code; sign-in by phone;
  - `EMAIL_TAKEN` for an operator's address;
  - a shopkeeper gets `WRONG_ACTOR` on `/payments/feed`, and can neither
    `POST /businesses` nor create an organization.
- **US4**: the feed lists cash and SPEI together; the channel filter; one
  fee per cash row.
- **US5**:
  - declaring, confirming and disputing a hand-over;
  - one pending hand-over at a time;
  - two businesses holding cash at one store never see each other's
    movements.

## 3. Walk through the pilot on `dev`

The prerequisites:
- the API is on dev with `RED_BASE_URL` set;
- `devolada-red-dev` is deployed at `red.dev.devoladapago.com`;
- you are signed in to the panel as a platform operator;
- a business has WispHub connected (the demo tenant).

1. **Reglas.** Set *Cargo por servicio en tiendas* to $15.00. The change
   shows your name and the time.
2. **Negocios.** Open the demo business and switch on *Efectivo en
   tiendas*. Try a second business: the panel refuses, and says why.
3. **Tiendas.** Create "Tienda de prueba" with your own phone. Open the
   invitation in WhatsApp.
4. **On the phone.** Open the link, set an email and a password, and type
   the code. You land on *Cobrar*, with the business's name in view. Add
   the app to the home screen.
5. **Search** for two letters: nothing. Then three letters of a demo
   customer with an open invoice: name, usuario and zone, nothing more.
6. **Choose the customer.** Check that the debt, the fee and the total
   match what WispHub shows. Collect the whole debt. A folio appears; the
   outcome moves from *En cola* to *Reconectado*, and the customer is
   active in WispHub.
7. **Send the receipt.** WhatsApp opens with the folio, the business, the
   amount and the fee.
8. **Search the same customer again**: *Sin adeudo*.
9. **Pagos**, on the panel: the payment is there, marked *Efectivo ·
   Tienda de prueba*. The *Efectivo* filter shows only it. The credit
   shows one fee.
10. **On the phone, *Caja*.** The amount held equals the payment. Declare
    a hand-over for it.
11. **Puntos de pago**, on the panel: the store holds that amount, with
    the hand-over pending. Confirm it in the dialog. Both screens show
    $0.00.
12. **Tiendas.** Suspend the store. On the phone, the next tap shows the
    suspended screen.

## 4. Before the first real collection (outside the code)

- `devolada-red`'s deploy workflows are turned off (research D30).
- The debt `store-cash-no-cap` is registered.
- The agreements in the spec's Assumptions are signed: business, store,
  and the legal check.
