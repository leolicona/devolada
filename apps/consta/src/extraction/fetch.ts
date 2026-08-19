/* D7 — Consta fetches the bytes, and that is new surface it must own.

   Until now Consta handed apiCEP a URL and apiCEP did the fetching, so
   every risk of pulling an arbitrary caller-supplied URL was theirs.
   Reading at our edge moves that risk here, and it arrives in one piece:
   scheme, address range, size, deadline, and what the file actually is. */

export const MAX_PROOF_BYTES = 1024 * 1024; // apiCEP's own limit, kept for parity
const FETCH_TIMEOUT_MS = 8_000;

export type ProofKind = "image" | "pdf";

export type FetchedProof = {
  bytes: Uint8Array;
  kind: ProofKind;
  /* The type the magic bytes say it is — never the one the caller claimed */
  mediaType: string;
  sha256: string;
};

export type ProofFetchCode =
  | "URL_NOT_ALLOWED"
  | "PROOF_UNREACHABLE"
  | "PROOF_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export class ProofFetchError extends Error {
  constructor(
    public code: ProofFetchCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/* Literal addresses that must never be fetched. This blocks the URL that
   *says* it is internal; it cannot block a public hostname whose DNS
   answer is private, because a Worker does not resolve names itself and
   never sees the address it connected to. That gap is real and recorded
   in the spec rather than papered over — the mitigation available here
   is that a signed, short-lived proof URL is what integrators actually
   pass, not user-typed input. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((o) => Number(o) > 255)) return true; // not an address at all
    return (
      a === 0 || // this network
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224 // multicast and reserved
    );
  }

  if (host.includes(":")) {
    /* IPv6 literal: allow only plainly-public unicast (2000::/3) */
    if (host === "::1" || host === "::") return true;
    if (/^f[cd]/.test(host)) return true; // unique-local
    if (/^fe[89ab]/.test(host)) return true; // link-local
    if (/^::ffff:/.test(host)) return true; // IPv4-mapped — re-check as v4 is not worth it
    return !/^[23]/.test(host);
  }
  return false;
}

/* Magic bytes, not the Content-Type header and not the caller's claim.
   A PDF served as image/png must still take the PDF route (D7), because
   the route decides which reader sees the file and a vision model given
   a PDF produces confident nonsense. */
function sniff(bytes: Uint8Array): { kind: ProofKind; mediaType: string } | null {
  const at = (i: number) => bytes[i];
  const starts = (...sig: number[]) => sig.every((b, i) => at(i) === b);

  if (starts(0x25, 0x50, 0x44, 0x46)) return { kind: "pdf", mediaType: "application/pdf" }; // %PDF
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: "image", mediaType: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { kind: "image", mediaType: "image/jpeg" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { kind: "image", mediaType: "image/gif" };
  if (starts(0x52, 0x49, 0x46, 0x46) && [8, 9, 10, 11].every((i, n) => at(i) === [0x57, 0x45, 0x42, 0x50][n])) {
    return { kind: "image", mediaType: "image/webp" };
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Read the body with a hard ceiling instead of trusting Content-Length,
   which is optional, and a lie when it is present and wrong. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_PROOF_BYTES) {
    throw new ProofFetchError("PROOF_TOO_LARGE", `Content-Length ${declared}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ProofFetchError("PROOF_UNREACHABLE", "empty body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROOF_BYTES) {
      await reader.cancel();
      throw new ProofFetchError("PROOF_TOO_LARGE", `over ${MAX_PROOF_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function fetchProof(rawUrl: string): Promise<FetchedProof> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProofFetchError("URL_NOT_ALLOWED", "unparseable URL");
  }
  if (url.protocol !== "https:") {
    throw new ProofFetchError("URL_NOT_ALLOWED", `scheme ${url.protocol}`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new ProofFetchError("URL_NOT_ALLOWED", "non-public address");
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      /* "manual", not "follow": a redirect could land on any of the
         addresses the checks above just refused, and following it would
         make those checks decorative. workerd rejects redirect: "error"
         outright, so the 3xx is caught below instead. */
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ProofFetchError("PROOF_UNREACHABLE", String(e));
  }
  if (res.status >= 300 && res.status < 400) {
    throw new ProofFetchError("URL_NOT_ALLOWED", `redirect to ${res.headers.get("Location") ?? "?"}`);
  }
  if (!res.ok) throw new ProofFetchError("PROOF_UNREACHABLE", `status ${res.status}`);

  const bytes = await readCapped(res);
  const sniffed = sniff(bytes);
  if (!sniffed) {
    throw new ProofFetchError("UNSUPPORTED_MEDIA_TYPE", `${bytes.byteLength} bytes, unrecognised`);
  }
  return { bytes, kind: sniffed.kind, mediaType: sniffed.mediaType, sha256: await sha256Hex(bytes) };
}
