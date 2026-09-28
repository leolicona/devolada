import { decimalToCents } from "../../money";
import { wallClockMs } from "../../time/business-day";
import type { CadenaFacts } from "./types";

/* cep-bundle-match D4 (research R5) — the cadena original, read once for
   both of its sources: a bundle CEP's three printed lines joined without
   spaces, and a single `valid`'s `cdaChain` in one line.

   Measured 2026-09-27 on eight CEPs and a `valid`'s cdaChain: version
   `01`, 43 pipe-separated fields, `||` at both ends. Positions, 1-based
   after the leading `||`:

      1 version            2 operation day DDMMAAAA   3 credit day DDMMAAAA
      4 credit time HHMMSS 5 receiver's SPEI code     6 sending bank
      7 sender's name      8 sender's account type    9 sender's account
     10 sender's RFC/CURP 11 receiving bank          12 beneficiary's name
     13 beneficiary's account type                   14 beneficiary's account
     15 beneficiary's RFC/CURP  16 concept  17 IVA   18 amount ("3.00")
     43 certificate number

   The clave and the reference are not in it. What leaves the parser is
   only what matching needs: the days, the time, the credit instant, the
   banks and accounts with their types, the amount in cents and the
   certificate. Names, RFC/CURP and the concept never leave it — so no
   record can hold them (FR-006, FR-010), by construction rather than by
   discipline. Anything that does not look exactly as measured is `null`,
   and the CEP it came from is unreadable: it confirms nothing (FR-002). */

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

export function parseCadena(text: string | null | undefined): CadenaFacts | null {
  const t = (text ?? "").trim();
  if (!t.startsWith("||") || !t.endsWith("||") || t.length < 5) return null;
  const f = t.slice(2, -2).split("|");
  if (f.length !== FIELDS || f[0] !== "01") return null;

  const operationDate = day(f[1]);
  const creditDate = day(f[2]);
  const creditTime = time(f[3]);
  const [receiverSpeiCode, senderBank, , senderAccountType, senderAccount] = f.slice(4, 9);
  const [receiverAccountType, receiverAccount] = f.slice(12, 14);
  const amount = f[17];
  const certificateNumber = f[FIELDS - 1];

  if (!operationDate || !creditDate || !creditTime) return null;
  if (!receiverSpeiCode || !senderBank?.trim()) return null;
  if (!/^\d{1,2}$/.test(senderAccountType) || !/^\d{1,2}$/.test(receiverAccountType)) return null;
  if (!digits(senderAccount) || !digits(receiverAccount)) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !digits(certificateNumber)) return null;
  /* Constitution II: the amount by string parsing, never `× 100` */
  const amountCents = decimalToCents(amount);
  if (amountCents <= 0) return null;

  return {
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
  };
}
