/* D7 — the engine reads the bytes, and that is surface it must own.

   Until proof-extraction, Consta handed apiCEP a URL and apiCEP did the
   fetching, so every risk of pulling an arbitrary caller-supplied URL was
   theirs. Reading at our edge moved that risk here, and it arrived in one
   piece: scheme, address range, size, deadline, and what the file
   actually is.

   consta-api-merge D7 (FR-008): the URL half of that guard left with the
   door it guarded. The fetch, the `https:`-only rule, the blocked-address
   list and the manual-redirect handling existed because an integrator
   could pass any URL; the engine is a module of the API now, the only
   caller is the API itself, and the file it reads is one the API already
   holds in its own bucket. What the guard also did — refuse a file that
   is not an image or a PDF, and refuse one over the ceiling — is a
   property of the bytes, not of the URL, and stays. */

export const MAX_PROOF_BYTES = 1024 * 1024; // apiCEP's own limit, kept for parity

export type ProofKind = "image" | "pdf";

export type LoadedProof = {
  bytes: Uint8Array;
  kind: ProofKind;
  /* The type the magic bytes say it is — never the one the caller claimed */
  mediaType: string;
  sha256: string;
};

export type ProofFetchCode = "PROOF_NOT_FOUND" | "PROOF_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";

export class ProofFetchError extends Error {
  constructor(
    public code: ProofFetchCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Ceiling → sniff → hash. The ceiling is a hard one on the bytes in
   hand, not a trusted Content-Length. */
export async function loadProof(bytes: Uint8Array): Promise<LoadedProof> {
  if (bytes.byteLength > MAX_PROOF_BYTES) {
    throw new ProofFetchError("PROOF_TOO_LARGE", `over ${MAX_PROOF_BYTES} bytes`);
  }
  const sniffed = sniff(bytes);
  if (!sniffed) {
    throw new ProofFetchError("UNSUPPORTED_MEDIA_TYPE", `${bytes.byteLength} bytes, unrecognised`);
  }
  return { bytes, kind: sniffed.kind, mediaType: sniffed.mediaType, sha256: await sha256Hex(bytes) };
}

/* The one way bytes enter the engine (consta-api-merge D7): a key in the
   product's own proof bucket, the same bucket direct payments and top-ups
   upload to. A key that names no object is `PROOF_NOT_FOUND` — new with
   the move, and not retryable: the upload budget and the link's own
   namespace decide what can be here, and nothing arrives later. */
export async function readProofFromBucket(bucket: R2Bucket, key: string): Promise<LoadedProof> {
  const object = await bucket.get(key);
  if (!object) throw new ProofFetchError("PROOF_NOT_FOUND", key);
  /* Through a Response, so the test doubles for the bucket (a body
     stream) and the real R2ObjectBody read the same way */
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return loadProof(bytes);
}
