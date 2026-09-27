import { unzipSync } from "fflate";

/* cep-bundle-match D3 — what the provider's "several matches" link holds.

   Measured 2026-09-26 on three bundles (E1, E6, F1): served as
   `application/pdf` under a `.pdf` name, and a ZIP all the same —
   `50 4B 03 04`, general-purpose flag 0x0808 (sizes in a data descriptor,
   so an entry's size comes from the central directory), no folders, one
   `CEP-<AAAAMMDD operation day>-<clave>.pdf` per matching transfer,
   ~28 KB each. So a bundle is recognised by its first bytes and never by
   its name or its declared type; a real PDF there is a bundle of one.

   Workers have no ZIP reader; `fflate` unzips (research R3), the same
   library the tests build their fixtures with. Pure: bytes in, bytes out. */

export type BundleKind = "zip" | "pdf";

/* By content only (D3): `PK\x03\x04` a ZIP, `%PDF-` one CEP, anything else
   is no bundle at all */
export function sniff(bytes: Uint8Array): BundleKind | null {
  const starts = (head: number[]) => bytes.length >= head.length && head.every((b, i) => bytes[i] === b);
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  return null;
}

/* The provider names an entry by the operation day and the clave; spec
   012's Banxico batch names the same PDF by the credit day and the clave
   (research R3). Two sources, two different days for one transfer — so
   only the clave is ever taken from a name, never a day (D3). */
const APICEP_ENTRY = /^CEP-\d{8}-([A-Z0-9]{6,30})\.pdf$/;
const BANXICO_ENTRY = /^\[\d{4}-\d{2}-\d{2}\]([A-Z0-9]{6,30})\.pdf$/;

export function claveOfEntry(name: string): string | null {
  /* No folders were measured; a path is read by its last segment anyway */
  const base = name.split("/").pop() ?? name;
  const match = APICEP_ENTRY.exec(base) ?? BANXICO_ENTRY.exec(base);
  return match ? match[1] : null;
}

/* The entries' names, in the order the archive lists them, without
   inflating a single one */
export function listEntries(bytes: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(bytes, {
    filter: (file) => {
      if (!file.name.endsWith("/")) names.push(file.name);
      return false;
    },
  });
  return names;
}

/* The entries `keep` wants, inflated; every other entry is skipped before
   its bytes are touched (`fflate`'s filter runs ahead of decompression).
   D3/D16: an entry whose clave the business already holds as a record is
   never opened again, so a due date's growing bundles cost each transfer
   one parse. Throws on a ZIP it cannot read — the caller calls that
   `unreadable`. */
export function readEntries(bytes: Uint8Array, keep: (name: string) => boolean): { name: string; bytes: Uint8Array }[] {
  const files = unzipSync(bytes, { filter: (file) => !file.name.endsWith("/") && keep(file.name) });
  return Object.entries(files).map(([name, data]) => ({ name, bytes: data }));
}
