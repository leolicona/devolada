import { z } from "zod";

/* Shareable contract (ARCHITECTURE.md): the admin derives types, MSW
   validates against it. The hub is one integration per business (pivot
   D10); "configured" means the row holds a key. */

export const mappedAction = z.enum(["register_and_reconnect", "register_only"]);

export const wisphubIntegration = z.object({
  provider: z.literal("wisphub"),
  configured: z.boolean(),
  /* settings D1, moved verbatim: the key is write-only — only enough of
     it to be recognised ever travels back */
  keyTail: z.string().nullable(),
  /* integrations-hub D4: the master switch; false = observation */
  actionsEnabled: z.boolean(),
  /* D3: three fixed rows, two actions each */
  mapping: z.object({
    exact: mappedAction,
    short: mappedAction,
    over: mappedAction,
  }),
  /* partial-payment D2/D4, moved house: they vote only under
     register_and_reconnect on the short row */
  thresholdPercent: z.number().int().min(0).max(100),
  floorCents: z.number().int().nonnegative(),
  /* provisional-release D10 as amended (D8): pre-verdict, lives here */
  provisionalReleaseEnabled: z.boolean(),
});

export const integrationsResponse = z.object({
  wisphub: wisphubIntegration,
  /* present when the patch carried a new key (settings D3, moved) */
  wisphubTest: z.object({ ok: z.boolean(), code: z.string().nullable() }).optional(),
});

export const wisphubPatchRequest = z
  .object({
    wisphubApiKey: z.string().trim().min(8),
    exactAction: mappedAction,
    shortAction: mappedAction,
    overAction: mappedAction,
    thresholdPercent: z.number().int().min(0).max(100),
    floorCents: z.number().int().nonnegative(),
    provisionalReleaseEnabled: z.boolean(),
    actionsEnabled: z.boolean(),
  })
  .partial();

/* settings D2, moved: test the typed candidate before it is saved;
   omit to test the stored one */
export const wisphubTestRequest = z.object({
  apiKey: z.string().trim().min(8).optional(),
});

export const wisphubTestResponse = z.object({
  ok: z.boolean(),
  code: z.string().nullable(),
  sampleCustomerCount: z.number().int().nullable(),
});

export type WisphubIntegration = z.infer<typeof wisphubIntegration>;
export type IntegrationsResponse = z.infer<typeof integrationsResponse>;
export type WisphubPatchRequest = z.infer<typeof wisphubPatchRequest>;
export type WispHubTestResponse = z.infer<typeof wisphubTestResponse>;
