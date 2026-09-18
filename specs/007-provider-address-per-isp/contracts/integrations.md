# Contract: the integration screen learns about installations

**Feature**: 007-provider-address-per-isp · **Date**: 2026-09-18

The zod schema is the contract (ARCHITECTURE.md): the admin derives its types
from it, MSW validates fixtures against it, Playwright stubs answer it. Every
change below lands in `apps/api/src/routes/integrations/schema.ts`, exported
as `@devolada/api/integrations-schema`.

One new export is added to the package: `@devolada/api/installations`, the
catalogue itself (D3).

---

## New: `@devolada/api/installations`

Pure data, imported by both sides. Shape per `data-model.md`.

```ts
export type InstallationKey = "wisphub_net" | "wisphub_io" | "wisphub_sandbox";

export type Installation = {
  key: InstallationKey;
  label: string;        // es-MX, what the ISP signs in at
  host: string;         // resolved by the API only; the admin never calls it
  kind: "real" | "test";
  isDefault: boolean;
};

export const INSTALLATIONS: readonly Installation[];
export function installationByKey(key: string): Installation | undefined;
export function defaultInstallation(): Installation;
```

The admin uses `key`, `label` and `kind`. It never uses `host` — it does not
talk to the provider (ARCHITECTURE.md: the API is the only party that does).

---

## Changed: `wisphubIntegration`

Two fields added. Everything existing keeps its shape, so no current reader
breaks.

```ts
export const wisphubIntegration = z.object({
  provider: z.literal("wisphub"),
  configured: z.boolean(),
  keyTail: z.string().nullable(),

  /* 007 FR-001/FR-004: which installation this business's credential
     belongs to. Null means none was chosen and the platform default is in
     use — every row that existed before this feature (FR-002). The panel
     shows the resolved one either way, and says when it was assumed. */
  installation: installationKey.nullable(),
  /* FR-004: what is actually being called, resolved through the catalogue.
     Present even when `installation` is null, because "which one am I on"
     is the question the screen must answer. */
  effectiveInstallation: z.object({
    key: installationKey,
    label: z.string(),
    kind: z.enum(["real", "test"]),
    /* true when it came from the platform default rather than a choice */
    assumed: z.boolean(),
  }),

  actionsEnabled: z.boolean(),
  mapping: z.object({ exact: mappedAction, short: mappedAction, over: mappedAction }),
  thresholdPercent: z.number().int().min(0).max(100),
  floorCents: z.number().int().nonnegative(),
  provisionalReleaseEnabled: z.boolean(),
});
```

`host` is deliberately absent from the response. The panel has no use for it
and an endpoint is not something the ISP should be reading or copying.

---

## Changed: `PATCH /integrations/wisphub`

```ts
export const wisphubPatchRequest = z.object({
  wisphubApiKey: z.string().optional(),
  /* 007 FR-005: a closed choice. A key outside the catalogue is rejected
     here as well as being unofferable in the panel — the column is text and
     a future writer is not the panel (data-model). */
  installation: installationKey.optional(),
  exactAction: mappedAction.optional(),
  shortAction: mappedAction.optional(),
  overAction: mappedAction.optional(),
  thresholdPercent: z.number().int().min(0).max(100).optional(),
  floorCents: z.number().int().nonnegative().optional(),
  provisionalReleaseEnabled: z.boolean().optional(),
  actionsEnabled: z.boolean().optional(),
});
```

**Behaviour**: when the request carries a key, an installation, or both, the
connection is re-tested against the installation **being saved** — the new one
if it is in the patch, the stored one otherwise (FR-009). The result rides
back on the same answer, as `wisphubTest` does today.

Saving is never blocked by a failed test. That rule predates this feature
(settings D3: the result is reported, never enforced) and it still holds: an
ISP who saves a key against the wrong installation must be able to fix the
installation without first clearing the key.

---

## Changed: `WispHubTestResponse`

The one code becomes four outcomes, each naming what was tried.

```ts
export const wisphubTestOutcome = z.enum([
  "OK",
  "INSTALLATION_UNREACHABLE",
  "KEY_REJECTED",
  "PERMISSION_MISSING",
]);

export const wisphubTestResponse = z.object({
  ok: z.boolean(),
  /* 007 FR-010: which of the three failures, never the one code that
     blamed the key for all of them. */
  outcome: wisphubTestOutcome,
  /* FR-010: the installation the test actually reached for, so an ISP can
     see Devolada knocked on the wrong door. Label, never host. */
  triedInstallation: z.object({ key: installationKey, label: z.string() }),
  /* FR-011 as amended by research D7: what was proven, and what was not.
     The writes cannot be verified without writing into a real ISP's
     billing, so they are named as unverified rather than assumed. */
  verified: z.array(z.enum(["customers", "invoices", "payment_methods"])),
  unverified: z.array(z.enum(["create_invoice", "register_payment", "auto_activate", "payment_promise"])),
  /* Which permission is missing, when the provider said so */
  missingPermission: z.string().nullable(),
  sampleCustomerCount: z.number().int().nullable(),
});
```

**Retired**: `code: "WISPHUB_AUTH_FAILED" | "WISPHUB_UNAVAILABLE" | null`.
`outcome` replaces it. The admin's three-branch message
(`WispHubScreen.tsx:125`) is rewritten against `outcome` — the current
"WispHub rechazó esta llave. Revísala en tu panel." is the line this feature
exists to stop showing when the key is fine.

---

## Unchanged on purpose

- **The envelope.** `{ success: true, data }` / `{ success: false, error: { code } }`
  with `UPPER_SNAKE` codes (constitution III). The four outcomes are *data* on
  a successful response, not error codes — the test succeeded in telling us the
  answer, which is the rule settings D2 already set and `testWisphubKey`
  already follows by answering 200 either way.
- **`WISPHUB_UNAVAILABLE` on the wire elsewhere.** Every other route keeps the
  single code. This feature widens the *connection test*, not the adapter's
  error vocabulary.
- **Authorization.** `requireArea("integrations", "manage")` already governs
  this route; the installation rides the same right (spec Assumptions). No
  role-matrix change.
