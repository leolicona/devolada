/* The public collections API's contract, aggregated (research D1). Exported
   from @devolada/api as ./v1-schema so the panel, the MSW handlers and the
   Playwright stubs validate against the same definitions the router uses.
   Each area's schema.ts is re-exported here as it lands. */
export { v1Error, v1ErrorCode, v1Notice, v1Ok, V1_ERRORS } from "./envelope";
export type { V1Error, V1ErrorCode, V1Notice } from "./envelope";
