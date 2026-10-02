# Contract: the código email

`passwordless-access` D2, D13. FR-024, FR-026. Both apps, from PR 1.

The sender is `sendAuthCode` in `apps/api/src/email/sender.ts`, called by the
email-OTP plugin's `sendVerificationOTP` hook (better-auth D9). It never
throws: onboarding and access must not depend on the email provider
(better-auth D8's law).

## The template, `sign-in`

There is one template for registration and for sign-in. The server must not
say which one is happening (FR-005).

| Part | Text |
| --- | --- |
| From | `EMAIL_FROM` (unchanged) |
| Subject | `{código} es tu código para entrar — Devolada` |
| Body | "Escribe este código en Devolada para entrar:", then the six digits large and spaced, then "Vence en 10 minutos.", then "Si no fuiste tú, ignora este mensaje." |

**Rules:**
- **No link.** No `<a>`, no URL, no "haz clic" (constitution VI,
  better-auth D4).
- The word is *código*. Never "OTP", "token" or "enlace".
- The digits sit in the subject too, so a phone's notification shows them
  without opening the email.

## Without `RESEND_API_KEY`

The código is written to the API's log instead of sent, as today
(constitution VIII):

```text
[código:sign-in] ana@negocio.mx → 482913
```

That is how a developer reads it locally (CLAUDE.md, after this feature).

## Retired with PR 2

The `email-verification` and `forget-password` templates leave with their
doors (D4).
