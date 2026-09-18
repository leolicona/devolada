# Quickstart: searchable-picker

**Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md)

How to run the feature and prove it does what [spec.md](./spec.md) promises.

## Prerequisites

```sh
pnpm install                       # pnpm 10 workspace, Node 22
```

Nothing else. The field needs no secret, no provider credential and no database —
it reads a generated list and calls the routes that already existed.

## See it

```sh
pnpm --filter @devolada/api dev     # the API on 8787, with a local D1
pnpm --filter @devolada/admin dev   # the panel on 5174
curl -X POST localhost:8787/dev/seed    # demo ISP: demo@devolada.app / devolada123
```

Sign in, then:

1. **The business's own bank** — *Configuración → Pago directo*. Put an account
   number in **CLABE** whose first three digits are not a recognised prefix (for
   example one starting `159…`), so the bank is not filled in for you. Now type
   into **Banco**.
2. **A top-up's sender** — *Saldo y recargas → Recargar → Banco desde el que
   transferiste*.
3. **The platform's own** — `/operador`, visible when your address is in
   `PLATFORM_OPERATOR_EMAILS`.

### What to try by hand

| Try this | Expect |
|---|---|
| Type `scotia` | SCOTIABANK alone |
| Type `ban` | names *beginning* with BAN first; NUBANK further down |
| Type `méxico` with the accent | BBVA MEXICO and CITI MEXICO |
| Type `zzz` | "Sin resultados", and Guardar stays unavailable |
| Type a fragment, then press Escape | the bank you had chosen comes back |
| Type a fragment, then click elsewhere | same |
| Type a fragment, then press Tab | same |
| Put your pointer away entirely | `↓` `↑` `Enter` do the whole job |
| Inside Recargar, press Enter with the list closed | the form submits, as it always did |

## Prove it

```sh
# What is offered, what commits, and axe on the open list
pnpm --filter @devolada/admin test -- test/bank-picker.test.tsx

# What needs a browser: real contrast in both themes, target size,
# focus, and the 360px floor
pnpm exec playwright test tests/e2e/bank-picker.spec.ts

# The gates, in CI order
node scripts/spec-lint.mjs
node scripts/gen-banks.mjs --check
node scripts/contrast-lint.mjs
node scripts/pending-lint.mjs
pnpm -r --if-present typecheck
pnpm -r --if-present test
```

## Check the success criteria

**SC-001 — every bank within 4 characters.** The number is derived from the
vocabulary and the ranking rule, so it can be re-derived rather than trusted:

```sh
node -e '
const src = require("fs").readFileSync("apps/api/src/direct-payments/banks.ts","utf8");
const BANKS = [...src.slice(src.indexOf("export const BANKS")).matchAll(/"([^"]+)"/g)]
  .map(m => m[1]).sort((a,b) => a.localeCompare(b,"es-MX"));
const n = s => s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const rank = q => { const nq = n(q); if (!nq) return BANKS;
  const s=[],c=[]; for (const b of BANKS) { const nb=n(b);
    if (nb.startsWith(nq)) s.push(b); else if (nb.includes(nq)) c.push(b); }
  return [...s,...c]; };
const VISIBLE = 8; let worst = 0, name = "";
for (const b of BANKS) { let k = 1;
  for (; k <= b.length; k++) { const i = rank(b.slice(0,k)).indexOf(b); if (i >= 0 && i < VISIBLE) break; }
  if (k > worst) { worst = k; name = b; } }
console.log(`worst case: ${worst} characters — ${name}`);
'
# → worst case: 4 characters — BANK OF CHINA
```

**SC-002 — nothing unreachable.** `tests/e2e/bank-picker.spec.ts` opens the list
in a real browser and reaches the last name in the sorted vocabulary.

**SC-003 — nothing outside the vocabulary can be saved.** Three tests in
`test/bank-picker.test.tsx`, one per way out of the field.

**SC-004 — no pointer needed.** The keyboard test in the same file chooses a bank
with `↓` and `Enter` and asserts what the save actually sent.

**SC-005 — one field, three screens.** All three import the same control; the
top-up screen's own test drives it exactly as the settings test does.

## What this feature does not do

- It does not touch the payer's page (research D8).
- It cannot clear a bank once one is chosen (research D10).
- It does not widen the account-number prefix map, so how often the field is
  needed at all is unchanged.
