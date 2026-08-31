/* WhatsApp helpers shared by the direct SPEI channel (receipt spec
   D2/D3 heritage): the API owns the message and the number. The store
   receipt text retired to devolada-red. */

/* WhatsApp needs digits with a country code. Mexican numbers arrive from
   WispHub in whatever shape the ISP typed them: 10 digits, with 52, with
   +52, with spaces or dashes. Anything we cannot read confidently becomes
   null and the link drops the number (D3) rather than opening a stranger's
   chat. */
export function toWhatsAppPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  /* 521XXXXXXXXXX: the old WhatsApp-only "1" that Mexico no longer needs */
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  return null;
}

/* D3: no number is not a dead end — WhatsApp opens its contact picker */
export function whatsAppLink(text: string, phone: string | null): string {
  const encoded = encodeURIComponent(text);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
