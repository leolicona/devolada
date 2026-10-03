import type { Context } from "hono";

/* passwordless-access D9 (as amended 2026-10-03), D10: the email-OTP
   plugin's own words for a código, carried through the envelope by the two
   doors of ours that check one on the server — the store acceptance and the
   member invitation's accept-new (contracts/store-access.md,
   contracts/panel-access.md). Better Auth throws an APIError with
   `statusCode` and `body.code`; anything else is not a código's answer and
   stays thrown. One module, so the two doors cannot drift apart
   (adversarial review, 2026-10-03). */
export const OTP_REFUSALS: Record<string, 400 | 403> = {
  INVALID_OTP: 400,
  OTP_EXPIRED: 400,
  TOO_MANY_ATTEMPTS: 403,
};

export function codeOf(e: unknown): string | null {
  const body = (e as { body?: { code?: unknown } } | null)?.body;
  return typeof body?.code === "string" ? body.code : null;
}

export function otpRefusal(c: Pick<Context, "json">, e: unknown): Response | null {
  const code = codeOf(e);
  return code && code in OTP_REFUSALS ? c.json({ success: false, error: { code } }, OTP_REFUSALS[code]) : null;
}
