import { BANKS } from "@devolada/api/settings-schema";

/* The vocabulary in the order a person reads it, defined once for the three
   admin screens that offer it (bug: bank-picker-unreachable).

   `BANKS` keeps the provider's own order and is generated, never transcribed
   (constitution III, scripts/gen-banks.mjs). This sorts a copy — it adds no
   name, drops none, and renames none. */
export const BANK_OPTIONS: readonly string[] = [...BANKS].sort((a, b) =>
  a.localeCompare(b, "es-MX"),
);
