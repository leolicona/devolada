/* provisional-release D4 — the opaque payer ref that travels to Consta.

   The natural identifier (the WispHub `usuario`, an email-shaped string)
   is recognisable, so it never leaves Devolada naked: what travels is an
   HMAC-SHA256 with a Devolada-held secret. Same aggregation power for
   Consta, zero legibility — trust-layer D1's own guidance, applied to
   ourselves. Deterministic per usuario, so the history accumulates under
   one key across months.

   Without the secret configured there is no ref and nothing travels:
   history collection quietly waits for the deploy that sets it, and
   validation itself is never blocked by it. */

const encoder = new TextEncoder();

export async function customerRefFor(secret: string, usuario: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(usuario));
  /* 64 hex chars — comfortably inside Consta's 128-char opaque cap */
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
