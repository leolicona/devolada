/* WhatsApp helpers shared by the direct SPEI channel (receipt spec
   D2/D3 heritage): the API owns the message and the number. The store
   receipt text retired to devolada-red. */

import { nationalPhone } from "../phone";

/* WhatsApp needs digits with a country code. Mexican numbers arrive from
   WispHub in whatever shape the ISP typed them: 10 digits, with 52, with
   +52, with spaces or dashes. Anything we cannot read confidently becomes
   null and the link drops the number (D3) rather than opening a stranger's
   chat. payment-without-receipt D2: what "a phone" is lives in the core's
   `nationalPhone`, shared with the payer's reference — this is `52` in
   front of it, the same outputs as before. */
export function toWhatsAppPhone(raw: string | null): string | null {
  const national = nationalPhone(raw);
  return national ? `52${national}` : null;
}

/* D3: no number is not a dead end — WhatsApp opens its contact picker */
export function whatsAppLink(text: string, phone: string | null): string {
  const encoded = encodeURIComponent(text);
  return phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}
