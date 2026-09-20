# Contract: the page and the Worker in front of it

**Feature**: 008-landing-page · **Date**: 2026-09-19, amended 2026-09-20 (D22, D23: one action, two forms, dark by default)

What the browser layer, the Worker test and the API's redirect rely on. A
change to any name here is a change to a test. Every atom named below is the
`@devolada/ui` component rendered to HTML at build by `@astrojs/react` with
no `client:*` directive (D2); the browser receives markup, not React.

---

## Routes the build emits (`build.format: "file"`, `trailingSlash: "never"`)

| Path | File | Purpose |
| --- | --- | --- |
| `/` | `index.html` | the page (spec FR-001) |
| `/gracias` | `gracias.html` | the request was received — the no-script outcome (D6) |
| `/no-enviada` | `no-enviada.html` | refused, limited or unavailable, with the contact address; `?motivo=<code>` read by its script when one runs, the default copy covers all three without one |
| `/privacidad` | `privacidad.html` | the full privacy notice (FR-022, D20) |
| `/404` | `404.html` | served by `not_found_handling: "404-page"` |

Workers static assets resolve `/gracias` to `gracias.html` and redirect
`/gracias.html` → `/gracias` (auto-trailing-slash handling).

---

## The DOM contract of `/`

| Selector | Meaning |
| --- | --- |
| `html[data-theme="dark"]` | the page renders the dark palette for everyone (D15) |
| `main > section:first-of-type` (`#inicio`) | the first screen: the eyebrow naming SPEI, the headline, the subhead, the hero form, the customer's line (FR-003, FR-011). At 360×740 the hero form's button ends inside the viewport. |
| `header a[data-login]` | the sign-in link for existing customers, `href="${LOGIN_URL}"`, class `buttonVariants({ variant: "link" })`; the only link to the product on the page (FR-004) |
| `form[data-form="hero"]` | the one-field form in the first screen: `input[name="whatsapp"]`, a hidden `input[name="form"][value="hero"]`, the hidden `channel` and honeypot inputs, the shared `Button` (`size="decisive"`) — `method="post"`, `action="${PUBLIC_API_URL}/landing/requests"`, `enctype="application/x-www-form-urlencoded"` |
| `form[data-form="full"]` (`#solicitar`) | the closing form: `whatsapp`, `name`, `billingSystem` (a `<select>` from `BILLING_SYSTEMS`), a hidden `input[name="form"][value="full"]`, the hidden `channel` and honeypot inputs, the same button and attributes |
| `input[name="channel"]` (hidden, one per form) | value `""` in the built file; the Worker sets both to the tag |
| `input[name="website"]` (the honeypot) | visually and accessibly hidden (`tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`), never required |
| `[data-field="<name>"] [data-error]` | the shared `Field` + `Input` (or the native `<select>` / `<textarea>` inside `Field`), rendered at build; where the field's es-MX message renders (FR-020) |
| `[data-outcome]` | the shared `Alert`, rendered at build once per outcome and shown by the script: received / refused / limited / unavailable, icon + words; `aria-live="polite"` |
| `button[type="submit"]` | the shared `Button` (`size="decisive"`), rendered at build — 64px |
| `[data-sending]` | the region that breathes while sending: `animate-breath` + `aria-busy="true"` after 200 ms, held ≥ 500 ms (D16) |
| `[data-claim="<id>"]` | every claim from `claims.ts`, rendered from the list, **once per id** (D11): `reply-sla` under the hero form, `activation-together` as the closing form's intro, `money-never-touches` in the Benefits card, `pricing-model` in the Pricing card |
| `[data-claim-echo="<id>"]` | a shortened echo of a claim rendered elsewhere — the proof tiles — never the claim's text; the tests look for the claim's text only under `[data-claim]` |
| `a[href="/privacidad"]` | beside the send button and in the footer (FR-022) |
| `a[href^="mailto:"]` | the human contact, visible without taking the action (FR-010) |
| `html[lang="es-MX"]` | |

The three payer-page strings appear verbatim in the "how it works" section:
"Haz tu transferencia", "Envía tu comprobante", "Tu pago fue registrado".

`<head>`: `<title>`, `<meta name="description">`, `<link rel="canonical">`,
`og:title`, `og:description`, `og:image` (`/og.png`, 1200×630),
`og:locale` `es_MX`, `twitter:card` `summary_large_image`,
`<meta name="theme-color">` for the dark surface, `<link rel="icon">`. No
`<script>` before `</body>`; every script is `type="module"` (deferred).

---

## The page's script (one module, ~4 KB)

1. On load: send `visit` with the channel read from the first
   `input[name="channel"]`.
2. On the first `focusin` inside either form: send `began`, once per page
   load.
3. On submit of either form: `preventDefault`; check `form.checkValidity()`; for each
   invalid field render its es-MX message from `ValidityState`; else POST
   JSON, apply the sending state (D16), and render the outcome from the
   envelope's `code` — `VALIDATION_ERROR` → "Revisa tus respuestas" (the
   route carries only a code; the page's own checks named the field first),
   `REQUEST_REFUSED` and `TOO_MANY_REQUESTS` → their copy plus the contact
   address — or "No pudimos enviar tu solicitud" with the contact address
   when the fetch itself fails (FR-021).
4. Nothing else. No tag handling (the Worker did it), no theme switch (D15).

Events are `fetch(`${API}/landing/events`, { method: "POST", mode: "no-cors",
keepalive: true, headers: { "content-type": "application/x-www-form-urlencoded" },
body })`.

---

## The Worker (`apps/landing/worker/index.ts`), proved in workerd

| Request | Answer |
| --- | --- |
| host begins with `www.` | `301` to the same URL without `www.`, path and query kept |
| any other, asset found | the asset from `env.ASSETS`, with the headers below; if HTML **and** `?ch=` matches `CHANNEL_PATTERN`: every `input[name="channel"]` gets `value="<tag>"` |
| any other, no asset | the assets binding's own 404 page (`404.html`) |

Headers on every response the Worker returns (D12):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${API_ORIGIN}; form-action 'self' ${API_ORIGIN}; frame-ancestors 'none'; base-uri 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains   (https only)
```

`API_ORIGIN` is the Worker's `var`; the test asserts the header carries the
value the binding holds.

---

## Build-time inputs

| Name | Source | Used for |
| --- | --- | --- |
| `PUBLIC_API_URL` | CI: `DEV_API_URL` / `PROD_API_URL`; local fallback `http://localhost:8787` | the form's `action`, the script's fetch base |
| `PUBLIC_SITE_URL` → `site` (astro config) | CI per environment; fallback `https://devoladapago.com` | canonical and Open Graph URLs, the product's host |
| `LOGIN_URL` | derived: `https://app.` + the site's host + `/login`; local fallback `http://localhost:5174/login` | the header's sign-in link |
