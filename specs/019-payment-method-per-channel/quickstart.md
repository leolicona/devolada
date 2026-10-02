# Quickstart: payment-method-per-channel

How to prove the feature works, from the fastest check to the pilot's
first payment. The rules being proven are in [research.md](research.md);
the shapes are in [contracts/](contracts/).

## 1. The automated proof (every PR)

```sh
pnpm install
pnpm --filter @devolada/api test -- test/payment-method-per-channel.test.ts
pnpm --filter @devolada/admin test -- -t "Formas de pago de Devolada"
pnpm -r --if-present typecheck
pnpm -r --if-present test          # the existing suites stay green unchanged
node scripts/spec-lint.mjs && node scripts/contrast-lint.mjs && node scripts/pending-lint.mjs
```

Expected:

| Scenario (API suite, WispHub at its origin) | What reaches `registrar-pago` |
| --- | --- |
| SPEI verdict, both methods exist | `forma_pago` = the SPEI method's id; `referencia` = `DV-… · <clave>` |
| A store's record, store channel on | `forma_pago` = the network method's id; `referencia` = `DV-… · <store name>` |
| *Ejecutar ahora* on a queued SPEI payment | Same as the SPEI verdict |
| The queue sweep on a queued store payment | Same as the store's record |
| No Devolada method | The cash method, as today; reference still written |
| The list has `CASH - RED.DEVOLADAPAGO` before "Cash" (R11) and no SPEI method | A SPEI payment records with "Cash", never with Devolada's name |
| The method was deleted (provider answers 400 `forma_pago`) | A second call with the cash method in the same attempt; the payment is `done` |
| A 400 naming another field | No second call; the action fails as today |
| The name typed as `spei-link . devoladapago` | Matched |
| Two methods with the SPEI name | The lowest id |
| A 300-character store name | Reference of 200 characters; folio intact; the name ends in `…` |

| Scenario (setup read and connection test) | Answer |
| --- | --- |
| Both exist, store channel on | `link: found`, `network: found` |
| Store channel off | `network: null` |
| One missing | `missing` on that line |
| Two with one name | `duplicate` |
| WispHub times out | `checked: false` — never `missing` |

The existing suites keep `formas-de-pago` as `[{ id: 7, nombre:
"efectivo" }]`: with no Devolada method they must pass untouched. A suite
that needs a change to stay green is a regression of FR-003, not a test to
update.

## 2. Local, against the demo tenant

Demo only: these steps write payments into the demo's billing. Never run
them with the pilot's key.

1. Put the demo's WispHub key in `apps/api/.dev.vars` as `WISPHUB_API_KEY`
   (git-ignored; a key that was ever pasted into a chat is revoked first).
   Point SPEI at the sandbox: `APICEP_BASE_URL=http://localhost:8789` and
   `APICEP_STORAGE_ORIGIN=http://localhost:8789`.
2. Start it:

   ```sh
   pnpm --filter @devolada/api db:migrate:local
   pnpm --filter @devolada/api sandbox
   pnpm --filter @devolada/api dev
   curl -X POST localhost:8787/dev/seed
   pnpm --filter @devolada/admin dev
   ```

3. Sign in as `demo@devolada.app`. Open *Integraciones → WispHub*. The
   block *Formas de pago de Devolada* shows `SPEI - LINK.DEVOLADAPAGO`
   *Creada* (the demo has had both since 2026-10-02, R8), and the
   network's line only if the demo business has the store channel on.
4. Create a link for a demo customer with a pending invoice, pay it
   against the sandbox, and wait for *Confirmado*.
5. In the demo's WispHub panel, open that invoice. Expected (R12): *Forma
   de Pago: SPEI - LINK.DEVOLADAPAGO - Referencia: DV-… · <clave>*. In
   *Lista de Facturas*, filter by that method: the invoice is there (R13).
6. FR-012 on the demo: rename `SPEI - LINK.DEVOLADAPAGO` in the panel
   (add an `X`). Within ten minutes the screen shows *Falta crearla*; the
   next payment records with "Cash" — **not** with
   `CASH - RED.DEVOLADAPAGO`, which today's adapter would pick (R11).
   Restore the name afterwards.

The Postman collection *WispHub · Formas de pago de Devolada (ESCRIBE)*
re-measures the provider's side (R8–R11) if WispHub's answers are ever in
doubt; it writes only on the demo, behind its own guard.

## 3. Rollout (D12)

1. Merge; dev deploys. Repeat §2 steps 3–5 against dev if dev's demo
   business has a key.
2. Release to prod (`git tag vX.Y.Z origin/main`) on a green Deploy Dev
   run.
3. **Only then** the pilot creates, in its WispHub, exactly
   `SPEI - LINK.DEVOLADAPAGO` and, if it uses the store network,
   `CASH - RED.DEVOLADAPAGO`, and uses neither at its counter.
4. The pilot opens *Integraciones → WispHub*: both lines read *Creada*.
   *Probar conexión* shows the same.
5. The pilot's first paid link: the invoice in WispHub carries the SPEI
   method and the reference; *Lista de Facturas* filtered by the method
   lists it and downloads it (the CSV carries the *Forma de Pago*
   column, R13).

Before step 2, the pilot must not create `CASH - RED.DEVOLADAPAGO`: the
adapter in production today would record **every** payment with it (R11).
