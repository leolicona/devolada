/* payment-without-receipt D2 — what counts as a Mexican phone.

   A customer has a phone when its digits, with a leading `52` or `521`
   removed, are exactly ten. Anything else — empty, a landline of another
   length, two numbers typed into one field — is no phone. Conservative on
   purpose: a wrong phone is a shared reference, while a missing one only
   costs the payer a number that is not their phone (research R1).

   Mexican numbering, not a provider's rule: the core owns it
   (constitution IX), and `toWhatsAppPhone` is built on it. */
export function nationalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("52")) return digits.slice(2);
  /* 521XXXXXXXXXX: the old mobile "1" Mexico no longer dials */
  if (digits.length === 13 && digits.startsWith("521")) return digits.slice(3);
  return null;
}
