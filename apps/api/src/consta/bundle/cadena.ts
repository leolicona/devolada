import { decimalToCents } from "../../money";
import { wallClockMs } from "../../time/business-day";
import type { CadenaFacts } from "./types";

/* cep-bundle-match D4 (research R5) — the cadena original, read once for
   both of its sources: a bundle CEP's three printed lines joined without
   spaces, and a single `valid`'s `cdaChain` in one line.

   Measured 2026-09-27 on eight CEPs: version `01`, 43 pipe-separated
   fields, `||` at both ends. Positions, 1-based after the leading `||`:

      1 version            2 operation day DDMMAAAA   3 credit day DDMMAAAA
      4 credit time HHMMSS 5 receiver's SPEI code     6 sending bank
      7 sender's name      8 sender's account type    9 sender's account
     10 sender's RFC/CURP 11 receiving bank          12 beneficiary's name
     13 beneficiary's account type                   14 beneficiary's account
     15 beneficiary's RFC/CURP  16 concept  17 IVA   18 amount ("3.00")
     43 certificate number

   D4 amended 2026-09-29 (bug: single-cep-unreadable) — measured on six
   `valid` answers, Azteca, Nu ×4 and Klar: the `cdaChain` is that same
   cadena followed by its seal, `||<43 fields>||<344 base64 characters>`.
   It never ends in `||`, and a reader that demanded it read none: dev held
   no record of a single `valid` by 2026-09-29. The seal after the closing
   bars is dropped here; the record keeps it from `digitalSignature` (D2).
   The same six carried the credit time as `processingTime`, and the
   credit day stayed the day the money arrived when the operation day
   moved: Klar, sent 2026-09-28 19:30:50, filed under the 29th, credited
   the 28th at 19:31:09.

   The clave and the reference are not in it. What leaves the parser is
   only what matching needs: the days, the time, the credit instant, the
   banks and accounts with their types, the amount in cents and the
   certificate. Names, RFC/CURP and the concept never leave it — so no
   record can hold them (FR-006, FR-010), by construction rather than by
   discipline. Anything that does not look exactly as measured is `null`,
   and the CEP it came from is unreadable: it confirms nothing (FR-002).
   It is the one source of a CEP's facts, for a bundle's and a single's
   alike (D19). */

const FIELDS = 43;
/* The CEP's own footnote: "La hora de abono corresponde al huso horario
   que rige en la Ciudad de México" — a fact of the document, not "today"
   (constitution II) */
export const CEP_TIMEZONE = "America/Mexico_City";

function day(ddmmaaaa: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(ddmmaaaa);
  if (!m) return null;
  const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (date.getUTCFullYear() !== yyyy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function time(hhmmss: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(hhmmss);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
  return `${m[1]}:${m[2]}:${m[3]}`;
}

const digits = (v: string) => /^\d+$/.test(v);

/* bug: single-cep-unreadable — what a cadena gave: its facts, or the check
   it failed. On dev (2026-09-28) a single `valid`'s cadena did not parse
   and nothing kept why; the answers had to be asked for again to learn it
   was the seal (D4, amended 2026-09-29). The reason names the check and
   never a value of the CEP — a name, an account — except the field count
   and a short numeric version, the two facts that tell another shape from
   a damaged one. */
export type CadenaReading = { facts: CadenaFacts } | { why: string };

/* What may follow the closing bars: nothing on a printed CEP, the seal on
   a `valid`'s cdaChain — base64, which never holds a `|` (D4). Measured
   2026-09-29: the seals dev keeps from printed CEPs are 344 characters of
   standard base64, padded `==` */
const SEAL = /^[A-Za-z0-9+/]+={0,2}$/;

export function readCadena(text: string | null | undefined): CadenaReading {
  const t = (text ?? "").trim();
  if (!t) return { why: "missing" };
  /* The closing bars are the last `||`: the seal holds no `|`, and an
     empty field would make an earlier pair inside the cadena */
  const close = t.lastIndexOf("||");
  if (!t.startsWith("||") || close < 2 || t.length < 5) return { why: "not delimited" };
  const after = t.slice(close + 2);
  if (after && !SEAL.test(after)) return { why: "not delimited" };
  const f = t.slice(2, close).split("|");
  if (f.length !== FIELDS) return { why: `${f.length} fields` };
  if (f[0] !== "01") return { why: `version ${/^\d{1,3}$/.test(f[0]) ? f[0] : "?"}` };

  const operationDate = day(f[1]);
  const creditDate = day(f[2]);
  const creditTime = time(f[3]);
  const [receiverSpeiCode, senderBank, , senderAccountType, senderAccount] = f.slice(4, 9);
  const [receiverAccountType, receiverAccount] = f.slice(12, 14);
  const amount = f[17];
  const certificateNumber = f[FIELDS - 1];

  if (!operationDate) return { why: "operation day" };
  if (!creditDate) return { why: "credit day" };
  if (!creditTime) return { why: "credit time" };
  if (!receiverSpeiCode) return { why: "SPEI code" };
  if (!senderBank?.trim()) return { why: "sender bank" };
  if (!/^\d{1,2}$/.test(senderAccountType) || !/^\d{1,2}$/.test(receiverAccountType)) return { why: "account type" };
  if (!digits(senderAccount) || !digits(receiverAccount)) return { why: "account" };
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return { why: "amount" };
  if (!digits(certificateNumber)) return { why: "certificate" };
  /* Constitution II: the amount by string parsing, never `× 100` */
  const amountCents = decimalToCents(amount);
  if (amountCents <= 0) return { why: "amount" };

  return {
    facts: {
      operationDate,
      creditDate,
      creditTime,
      creditedAt: wallClockMs(CEP_TIMEZONE, creditDate, creditTime),
      senderBank: senderBank.trim(),
      senderAccountType,
      senderAccount,
      receiverSpeiCode,
      receiverAccountType,
      receiverAccount,
      amountCents,
      certificateNumber,
    },
  };
}

export function parseCadena(text: string | null | undefined): CadenaFacts | null {
  const read = readCadena(text);
  return "facts" in read ? read.facts : null;
}
