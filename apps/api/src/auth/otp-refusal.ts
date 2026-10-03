import type { Context } from "hono";

/* passwordless-access D9 (as amended 2026-10-03), D10: the email-OTP
   plugin's three refusals of a código. Better Auth throws an APIError with
   `statusCode` and `body.code`; anything else is not a código's answer and
   stays thrown.

   Every door answers the three as one: 400 INVALID_OTP (FR-033, SC-006;
   adversarial review, 2026-10-03). OTP_EXPIRED and TOO_MANY_ATTEMPTS exist
   only for an address that holds a live código, and `POST
   /store/sign-in/code` writes one only under the email of the store a phone
   names — so any door that passed them through let a guessed email tell a
   store's phone from a stranger's. That was true of Better Auth's public
   door (folded below), of the store acceptance and, for an invited
   address, of accept-new. The screens of both apps already read the three
   alike ("El código no es válido o ya venció…"), so nobody loses a word.
   One module, so no door can drift apart. */
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
  return code && code in OTP_REFUSALS ? c.json({ success: false, error: { code: "INVALID_OTP" } }, 400) : null;
}

/* passwordless-access FR-033, SC-006 (adversarial review, 2026-10-03):
   over HTTP the plugin's own código door says OTP_EXPIRED or
   TOO_MANY_ATTEMPTS only to an address that holds a live código — a
   missing row is always INVALID_OTP (better-auth 1.6.29
   email-otp/routes.mjs, `atomicVerifyOTP`). And
   `POST /store/sign-in/code` writes a código only under the email of the
   store a phone names. So four wrong tries on that door with a guessed
   email told a store's phone from a stranger's, around the fold
   `POST /store/sign-in` already does (D10). The HTTP door folds the two
   into the plugin's own INVALID_OTP answer, byte for byte, as the store
   route does; the screens show one message for the three anyway
   (contracts/panel-access.md), so nobody loses a word. Only the timing of
   that door is left; that one is the creator's call, not this fold's.
   The server's own `auth.api` calls never come through here: our routes
   fold them with `otpRefusal` above. */
const FOLDED_OVER_HTTP = new Set(Object.keys(OTP_REFUSALS).filter((code) => code !== "INVALID_OTP"));

export async function foldCodeRefusal(res: Response, invalidOtp: { code: string; message: string }): Promise<Response> {
  if (res.status !== 400 && res.status !== 403) return res;
  let code: unknown;
  try {
    code = ((await res.clone().json()) as { code?: unknown } | null)?.code;
  } catch {
    return res;
  }
  if (typeof code !== "string" || !FOLDED_OVER_HTTP.has(code)) return res;
  /* better-call answers a thrown `APIError.from("BAD_REQUEST", …)` with
     `{message, code}` in that order and the status's name as statusText
     (to-response.mjs); the suite compares the bytes with the plugin's own */
  const body = JSON.stringify({ message: invalidOtp.message, code: invalidOtp.code });
  /* every other header is the plugin's own — set-cookie and the rest */
  const headers = new Headers(res.headers);
  if (headers.has("content-length")) headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
  return new Response(body, { status: OTP_REFUSALS.INVALID_OTP, statusText: "BAD_REQUEST", headers });
}
