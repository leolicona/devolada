import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/* The /v1 envelope (contracts/public-api.md, constitution III). The same
   `{ success, data }` / `{ success: false, error }` shape as every other
   route, plus the one extension the constitution grants a surface whose
   callers are programs: `error.retryable`, and an optional `error.message`
   saying which field or which piece. Logged in plan.md's Complexity
   Tracking: FR-025 requires a caller to tell "retry this" from "fix your
   request", and a code list alone cannot say which is which — every
   consumer would invent its own retry policy from our error names, which
   is the drift the one-contract rule exists to stop. */

/* Every code this surface can answer, with whether waiting can help. The
   table is the contract's "Error codes" section; a code outside it is a
   bug, not a new case. */
export const V1_ERRORS = {
  AUTHENTICATION_ERROR: { status: 401, retryable: false },
  VALIDATION_ERROR: { status: 400, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  LINK_CLOSED: { status: 409, retryable: false },
  CHANNEL_UNAVAILABLE: { status: 409, retryable: false },
  BUSINESS_SUSPENDED: { status: 409, retryable: false },
  INSECURE_URL: { status: 400, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  INTERNAL_SERVER_ERROR: { status: 500, retryable: true },
} as const satisfies Record<string, { status: ContentfulStatusCode; retryable: boolean }>;

export type V1ErrorCode = keyof typeof V1_ERRORS;

export const v1ErrorCode = z.enum(
  Object.keys(V1_ERRORS) as [V1ErrorCode, ...V1ErrorCode[]],
);

export const v1Error = z.object({
  success: z.literal(false),
  error: z.object({
    code: v1ErrorCode,
    retryable: z.boolean(),
    /* Which field (VALIDATION_ERROR) or which piece the business has not
       configured (CHANNEL_UNAVAILABLE: `clabe` or `bank`). Never a
       provider's words, never es-MX copy — this surface has no screen. */
    message: z.string().optional(),
  }),
});
export type V1Error = z.infer<typeof v1Error>;

/* The success half, parameterised by the area's data shape */
export const v1Ok = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data });

/* Notices ride a success, never an error (FR-009): a platform condition —
   Devolada's own validation unavailable in this environment — is not the
   caller's to fix, so the link is created and the answer says so beside
   it. `CHANNEL_UNAVAILABLE` stays for what only the business can fix. */
export const v1Notice = z.object({
  code: z.enum(["VALIDATION_UNAVAILABLE"]),
});
export type V1Notice = z.infer<typeof v1Notice>;

/* Only `json` is needed, so any Hono context qualifies whatever its
   Bindings and Variables — the routers give the middleware a typed one. */
type JsonContext = Pick<Context, "json">;

/* One way to fail on this surface: the code decides the status and
   whether retrying can help; the handler never picks either by hand. */
export function fail(c: JsonContext, code: V1ErrorCode, message?: string) {
  const { status, retryable } = V1_ERRORS[code];
  const body: V1Error = {
    success: false,
    error: { code, retryable, ...(message ? { message } : {}) },
  };
  return c.json(body, status);
}

export function ok<T>(c: JsonContext, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true as const, data }, status);
}
