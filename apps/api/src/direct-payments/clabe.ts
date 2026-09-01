import type { Bank } from "./banks";

/* business-and-memberships D5: the CLABE's first three digits name the
   bank (Banxico's institution code), so the picker is pre-selected from
   the provider vocabulary and the payer never types a bank name
   (direct-payment D16, BUG-007). Only names that exist in `BANKS` may
   appear here; an unknown prefix means "pick it yourself", never a guess. */
const PREFIX_TO_BANK: Record<string, Bank> = {
  "002": "BANAMEX",
  "006": "BANCOMEXT",
  "009": "BANOBRAS",
  "012": "BBVA MEXICO",
  "014": "SANTANDER",
  "019": "BANJERCITO",
  "021": "HSBC",
  "030": "BAJIO",
  "036": "INBURSA",
  "042": "MIFEL",
  "044": "SCOTIABANK",
  "058": "BANREGIO",
  "059": "INVEX",
  "060": "BANSI",
  "062": "AFIRME",
  "072": "BANORTE",
  "106": "BANK OF AMERICA",
  "113": "VE POR MAS",
  "127": "AZTECA",
  "130": "COMPARTAMOS",
  "133": "ACTINVER",
  "136": "INTERCAM BANCO",
  "137": "BANCOPPEL",
  "143": "CONSUBANCO",
  "147": "BANKAOOL",
  "166": "BaBien",
  "638": "NUBANK",
  "646": "STP",
  "659": "ASP INTEGRA OPC",
  "684": "TRANSFER",
  "706": "ARCUS FI",
  "710": "NVIO",
  "722": "Mercado Pago W",
  "728": "SPIN BY OXXO",
};

export function bankForClabe(clabe: string): Bank | null {
  const digits = clabe.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return PREFIX_TO_BANK[digits.slice(0, 3)] ?? null;
}
