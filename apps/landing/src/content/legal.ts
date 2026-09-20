/* The legal identity the privacy notice names (landing-page D20; FR-022).

   RESPONSABLE and DOMICILIO are the creator's to give — the legal person
   and address that answer for the data the form collects (LFPDPPP art.
   16, I). Given by the creator on 2026-09-20; test/content.test.ts
   refuses a placeholder here, so the page could not publish without them. */
export const RESPONSABLE = "Leobardo Licona Soto";
export const DOMICILIO = "Calle 5 de Mayo 106, Col. El Saucillo, C.P. 42186, Mineral de la Reforma, Hidalgo";

/* The address a reader writes to when the form cannot send, and the one
   the privacy notice names for access, correction, cancellation and
   opposition (FR-019, FR-021, FR-022). It MUST equal the platform's
   `support_email` setting — the value `GET /support` answers — and the
   quickstart's pre-flight checks that it does. The footer does not
   carry it: the page's one way to reach a person is the WhatsApp form
   (canvas v13, 2026-09-20). */
export const CONTACT_EMAIL = "hola@devoladapago.com";
