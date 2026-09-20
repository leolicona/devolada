/* The legal identity the privacy notice names (landing-page D20; FR-022).

   RESPONSABLE and DOMICILIO are the creator's to give — the legal person
   and address that answer for the data the form collects. They are born
   as placeholders, and test/content.test.ts fails while either remains,
   so the page cannot publish without them. */
export const RESPONSABLE = "{{RESPONSABLE}}";
export const DOMICILIO = "{{DOMICILIO}}";

/* The address a reader writes to when the form cannot send, and the one
   the privacy notice names for access, correction, cancellation and
   opposition (FR-019, FR-021, FR-022). It MUST equal the platform's
   `support_email` setting — the value `GET /support` answers — and the
   quickstart's pre-flight checks that it does. The footer does not
   carry it: the page's one way to reach a person is the WhatsApp form
   (canvas v13, 2026-09-20). */
export const CONTACT_EMAIL = "hola@devoladapago.com";
