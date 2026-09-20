# Research: Landing Page

**Feature**: 008-landing-page · **Date**: 2026-09-19

Twenty-three decisions. Each names what was chosen, why, and what was rejected.
D22 and D23 come from the design session of 2026-09-20 (spec Clarifications,
same date) and amend D4, D7, D8, D11, D15, D17 and D20 in place; each amended
decision says so.
Where a fact was measured — a registry version, a documentation page, a DNS
answer — the date is the day it was read: 2026-09-19.

---

## D1 — A static page on an assets Worker with a small script; nothing rendered on demand

**Decision**: `apps/landing` is an Astro project with `output: "static"`
(the default) and no adapter. `astro build` writes plain HTML, CSS and one
small script into `dist/`; a Worker serves that directory as static assets
and runs a short script in front of it (`assets.run_worker_first: true`,
D3). The form posts to the API (D5); the page itself has no server.

**Rationale**: the page is words. Every requirement that touches speed,
resilience and honesty (FR-021, FR-030, SC-002, SC-009) is answered for free
by a page that is already HTML before any script runs: it reads when the
product is down, it costs the visitor a few files, and there is no runtime to
keep alive. It ships the way the payment page ships — an assets Worker with
custom domains — so it inherits the release path, the preview versions and
the rollback (FR-032) without a new kind of deploy.

The creator asked for Astro by name. It fits the page for the reason above,
and it is the one departure from the fixed stack table this plan makes; the
plan's Complexity Tracking justifies it and D19 proposes the amendment.

**Alternatives rejected**:

- *React + Vite, like the two apps.* Would ship a client runtime for a page
  with one form, and would make "every word reads before any script" a
  discipline rather than the build's output.
- *Astro rendered on demand (`@astrojs/cloudflare`).* Buys server rendering
  the page has no use for, adds `nodejs_compat` and a server bundle, and
  turns "the page reads when the product is down" into a property of one
  more Worker.
- *A page hosted outside the repo (a site builder, a form service).* Breaks
  FR-026, FR-027 and FR-032 at once: a second visual identity, third-party
  origins, a release path nobody gates.

---

## D2 — The page wears the product's stylesheet and renders the shared atoms at build time; nothing framework-shaped reaches the browser

**Decision**: the landing's global stylesheet is one line —
`@import "@devolada/ui/styles.css";` — exactly as `apps/pago/src/styles.css`
does. Tokens, Tailwind mapping, self-hosted fonts and the motion utilities
arrive together. The shared atoms are used **as they are**: `@astrojs/react`
(6.0.6, React 19; measured 2026-09-19) lets an `.astro` component render
`Field`, `Input`, `Alert`, `Button` and `StatusBadge` from `@devolada/ui`
**without a `client:*` directive**, so Astro turns them into HTML at build
and ships no JavaScript for them. The one control that must be a link — the
header's sign-in link — takes its classes from `buttonVariants()` in
frontmatter, the recipe the package exports for exactly that (amended
2026-09-20 with D22: the sign-up link is gone). `Pending` and `Reveal` are not rendered: they need hydration;
the waiting state is the page's script on the shared thresholds (D16).
`vite.ssr.noExternal` lists the two workspace packages so Vite transforms
their TypeScript, JSX and CSS during the build instead of handing them to
Node.

**Amended 2026-09-19**, after the creator asked whether Astro fits the
design system. The first version relied on `buttonVariants` alone and would
have rewritten the field, the input and the outcome alert in Astro "with the
same classes" — measured that day: only `button.tsx` exports a recipe. That
rewrite is the drift constitution VI names. Rendering the atoms at build
keeps one definition, costs the browser nothing, and changes nothing in
`packages/ui`.

**Rationale**: constitution VI makes `packages/ui` the one definition of a
shared atom. Astro's build-time rendering is the way to consume a React
atom from a page that ships no React; the recipe export is the way to
consume the button's look on an element that is not a button. The
stylesheet already declares `@source "../"` so utilities used only inside
the shared package reach the output — the same gap the two apps hit and
fixed once.

**Alternatives rejected**:

- *Extracting recipes (`inputVariants`, `alertVariants`, …) into
  `packages/ui` and calling them from Astro.* One definition too, but a
  refactor of five atoms for one consumer. Kept as the long-term shape if a
  second framework-free surface ever appears.
- *Hydrated React islands (`client:*`).* React in the browser for a form the
  script already drives.
- *Copying the atoms' classes into `.astro` components.* The drift VI names.

---

## D3 — The Worker owns the host redirect, the channel injection and the headers

**Decision**: `apps/landing/worker/index.ts` runs before asset matching. It
(1) answers any `www.` host with a 301 to the same URL without it, path and
query intact; (2) fetches the asset from `env.ASSETS`; (3) when the request
carries a channel tag (D4) and the asset is HTML, rewrites the hidden
`channel` input of each form with `HTMLRewriter` (amended 2026-09-20: there
is no sign-up link to rewrite, D22); (4) sets the security headers and the
CSP (D12).

**Rationale**: measured 2026-09-19 in the Workers documentation — a
`_redirects` file cannot express a domain-level redirect ("Domain-level
redirects ❌"), and headers from a `_headers` file "are not applied to
responses generated by your Worker code". Once a script exists for the
redirect, the other two behaviours belong in the same place and get the same
test. `run_worker_first: true` means every request runs the script; for a
page at this scale that is a rounding error, and it is what makes FR-025
unconditional: the tag reaches the form and the link whether or not scripts
run in the visitor's browser.

**Alternatives rejected**:

- *A zone-level redirect rule for `www`.* Lives in the dashboard, outside the
  repo and outside CI. production-launch accepted such acts for a bucket
  policy; nothing here needs one.
- *Client-side injection of the tag.* Lost the moment scripts do not run —
  and the spec's edge case says the request still goes.

---

## D4 — The channel tag: `?ch=`, a small charset, "direct" otherwise, kept as typed

**Decision**: the tag rides the query parameter `ch`. A value matching
`^[A-Za-z0-9_-]{1,32}$` is kept exactly as typed — case included — and
travels into the hidden `channel` field of both forms, the beacon (D8) and
the request row. Anything else, or no tag, is `direct`. (Amended 2026-09-20:
the tag no longer rides a sign-up link — D22.) The charset is enforced in the Worker (D3), in the beacon and in
the API's schema; the same regular expression lives in
`@devolada/api/landing-schema` and is imported everywhere it is checked.

**Rationale**: FR-025 says a tag the creator never made is kept as typed,
which rules out a catalogue of known tags; the charset keeps "as typed"
from meaning "anything a stranger can put in an attribute". Case is kept
because the creator may type `WhatsApp-ISP` and expect to find it so.

**Alternatives rejected**:

- *Lower-casing.* Tidier groups, but it silently edits what the creator made.
- *Full UTM parameters.* Five fields for one question; the creator makes
  one tag per share.

---

## D5 — Requests and counts live in the API's database, owned by the platform

**Decision**: two additive tables in the product's D1 — `access_requests`
and `landing_counts` (data-model.md) — with no `business_id`, like
`platform_settings`. One new area, `apps/api/src/routes/landing/`, exports a
public router mounted at `/landing` (`POST /requests`, `POST /events`) and an
operator router that `platformRoute` mounts at `/platform/landing`
(`GET /requests`, `GET /counts`), behind the existing
`requireSession + requirePlatformOperator`. The schema is exported as
`@devolada/api/landing-schema` and imported by the page at build, by the
admin, and by the MSW handlers and Playwright stubs.

**Rationale**: the constitution names one database and one party that talks
to Resend. A D1 binding on the landing Worker would give the page a second
door into the platform's data and a second sender; a form service would put
a person's name on a third party's origin (FR-027) and outside the export
the creator is promised (FR-017).

**Alternatives rejected**:

- *A D1 binding on the landing Worker.* Two writers to one database, and a
  Worker that must know the operator's email key.
- *A third-party form or analytics service.* See above; also a new origin
  the CSP would have to admit.

---

## D6 — One request door, two answers: the envelope for scripts, an outcome page for a plain form post

**Decision**: `POST /landing/requests` accepts `application/json` (the
page's script) and `application/x-www-form-urlencoded` (the HTML form when
no script runs). A JSON request is answered in the envelope: `{ success:
true, data: { id, receivedAt } }` or `{ success: false, error: { code } }`.
A form post is answered with `303 See Other` to an outcome page on the
landing — `/gracias` when received, `/no-enviada?motivo=<code>` when refused
or rate-limited — built from the `LANDING_BASE_URL` binding. When that
binding is unset (a developer's machine), the form post is answered with the
envelope too, and `env.ts` says so.

**Rationale**: a browser navigating a form is not a program reading an
envelope; it needs a page. Two static outcome pages are the cheapest honest
answer for the no-script visitor, and they keep the API free of HTML. The
spec's FR-001 names "the request's confirmation" among the page's few other
addresses; the outcome pages are that confirmation, one per outcome.

**Alternatives rejected**:

- *The API renders an es-MX confirmation page itself.* An API that serves
  HTML, once.
- *Redirect to the `Referer`.* An open-redirect shape; a fixed binding costs
  nothing.

---

## D7 — Field rules are stamped into the form at build; no validator in the browser

**Decision**: `@devolada/api/landing-schema` exports the zod schema and,
beside it, the constants the schema is built from: `BILLING_SYSTEMS`,
`FIELD_LIMITS`, `WHATSAPP_PATTERN`, `CHANNEL_PATTERN`, `FORMS` (amended
2026-09-20 with D23: no size bands, no email, no business name, no note).
The two `.astro` forms read those constants in frontmatter and stamp them
into `required`, `maxlength`, `pattern`, `type` and the `<option>` list. The client script does not
import zod: it turns the browser's `ValidityState` into es-MX messages next
to the field (FR-020), sends the request, and maps the API's `error.code`
onto es-MX copy. The API's zod schema remains the only validator that
decides.

**Rationale**: constitution III keeps the schema the contract; stamping its
constants at build keeps one source without shipping ~15 KB of validator for
three fields. The browser-facing route carries only a `code` (III), so the
page must know its own field rules to name the field at fault — the
attributes are those rules.

**Alternatives rejected**:

- *Import the zod schema into the client.* A second runtime validator to
  keep in step, for no rule the attributes cannot express.
- *Hand-written HTML attributes.* Drift from the schema, silently.

---

## D8 — Counting is a first-party beacon into three aggregate steps; a visit is a page load

**Decision**: the page sends two events to `POST /landing/events` —
`visit` once the page has loaded, `began` on the first focus inside either
form — as `fetch` with `keepalive` and a form-encoded body (no preflight,
survives navigation). `sent` is counted by the API when it stores a request.
(Amended 2026-09-20: the `signup` step left with the sign-up link, D22.) Each event increments one row
of `landing_counts` keyed by `(day, channel, step)`. `day` is the calendar day
in `America/Mexico_City` — the platform's own "today" (constitution II applies
the business's timezone to the business's counts; the platform's counts take
the platform's). Nothing per visitor is written: no address, no user agent,
no cookie, no hash. A visit is a page load, stated as such on the operator
screen.

**Rationale**: the spec's funnel (visit → began → sent) by channel is not
something a generic analytics product answers, and SC-010 forbids the
fingerprint that "unique visitors" would need. Three counters in the
product's own database answer FR-023 exactly and put the numbers beside the
requests (FR-024, "one place").

**Alternatives rejected**:

- *Cloudflare Web Analytics.* Cookieless and free, but no custom steps, no
  channel breakdown, and a script from a third origin (FR-027).
- *A daily-rotating hash of address and agent (the Plausible approach).* A
  device fingerprint for a day; SC-010 says none.
- *Counting visits in the Worker without a script.* Immune to blockers, but
  it counts every crawler as a visit.

---

## D9 — Abuse: the existing per-address limiter, and a field no person fills

**Decision**: `rateLimitRoute("landing-request", { window: 3600, max: 5 })`
on the request door (FR-019's five per hour) and
`rateLimitRoute("landing-event", { window: 3600, max: 60 })` on the beacon.
The form carries a hidden `website` field; a non-empty value is refused with
`REQUEST_REFUSED` (400) and stored nowhere. A rate-limited request answers
`TOO_MANY_REQUESTS` (429), as the limiter already does. Both refusals reach
the visitor as words plus the contact address (FR-019).

**Rationale**: `auth/rate-limit.ts` already implements exactly this shape —
a per-address window in D1, keyed with a `hono:` prefix, disarmed in the
suite by `AUTH_RATE_LIMIT=off` and re-armed by the limiter's own test. No
puzzle for a person (FR-019).

**Alternatives rejected**:

- *A CAPTCHA.* The spec forbids it; it fails the phone-in-a-messaging-app
  reader first.
- *A new counter table.* The v1 surface has one keyed by business; this
  door has no business. The auth limiter's table fits.

---

## D10 — Notification: one attempt at submission, the failure written on the row, no retry

**Decision**: when a request is stored, the handler sends one email to the
addresses in `PLATFORM_OPERATOR_EMAILS` through Resend, in the request's
`waitUntil`. Success writes `notified_at`; failure writes `notify_error`
(the provider's status or `NO_OPERATOR_EMAILS` / `NO_RESEND_KEY`). Without
`RESEND_API_KEY` the notice is logged, as the OTP is. The operator list shows
each request's notice state (FR-018). No sweep retries.

**Rationale**: FR-018 asks that a failed notification lose nothing and hide
nothing; the row and the list answer both. A retry on the cron would add a
sweep for a case whose safety net — the list — already exists, and the
constitution asks new periodic work to earn its place.

**Alternatives rejected**:

- *Retry from the every-minute sweep.* Kept as the follow-up if the log ever
  shows a real run of failures.

---

## D11 — Claims are a typed list with a basis, rendered from the list, reviewed before publication

**Decision**: `apps/landing/src/content/claims.ts` exports a frozen array of
`{ id, text, basis }` — the sentence the page says, and the product
behaviour or decision that makes it true (`direct-payment D3`, a spec
requirement, a file). Components render a claim by id; a claim that is not in
the list is not on the page. A unit test refuses an entry without a basis; a
browser test asserts every claim's text appears on the page; the quickstart's
pre-flight is the human review of the list against the product (FR-013).

**Rationale**: FR-013 and SC-008 ask for a reviewed list tied to behaviour.
Making the list the *source* of the claims, rather than a document beside
them, means removing a claim removes it from the page in the same change.

**Amended 2026-09-20** — the list follows the canvas (v12). Entries and their
bases: `money-never-touches` (*directo a tu CLABE; Devolada nunca lo toca* —
`direct-payment D3/D4`); `system-stays-record` (*tu sistema sigue mandando;
Devolada le avisa y él reactiva el servicio* — the reconnection queue);
`spei-verified` (*SPEI verificado contra Banxico* — `consta/validate.ts`);
`auto-reactivation` (*se verifica el pago y el internet vuelve solo* — the
reconnection queue); `no-fake-receipts` (*lo inventado, lo editado y lo
repetido no pasan* — status `invalid`, `direct-payment D8/D17`);
`partial-visible` (*si te pagan de menos, lo ves como parcial* — status
`partial`, `payments-and-classes D1`); `verification-time` (*le pregunta a
Banxico en cuanto llega el comprobante e insiste durante horas* — the
re-validation slots); `any-bank` (*cualquier CLABE de cualquier banco* —
`scripts/banks.data.md`); `system-down` (*la reactivación espera en cola, a la
vista* — `reconnection-queue D2`); `pricing-model`
(*Prepago. Por pago verificado. Sin mensualidad ni contrato. Los primeros
pagos son gratis.* — `prepaid-credit D2/D4`, `platform/settings.ts`);
`reply-sla` (*te escribimos en menos de un día hábil* — FR-016, the
creator's promise); `activation-together` (*lo activamos contigo, hasta tu
primer pago verificado* — the activation workflow, spec §The workflow the
page starts). Gone with the page's copy: `own-software-loop` and
`permanent-link` (the page now says *un link por cliente* inside the steps,
which `payment_links.mode = "reusable"` still backs). Each claim is rendered
once by id; the proof tiles shorten three of them (*Directo a tu CLABE*,
*Primeros pagos gratis*, *SPEI verificado contra Banxico*) and carry
`data-claim-echo`, so the browser test finds one text per claim
(`/speckit-analyze` 2026-09-20, I1). Gone in the second session of
2026-09-20 (D25): `customer-meanwhile` — the page no longer says *Tu
servicio sigue activo*. The payment flow's third moment shows *Reconectado*,
which is the product's own `StatusBadge` word for a done reconnection
(`packages/ui/src/components/status-badge.tsx`), a rendered fact rather than
a sentence the list has to vouch for.

**Alternatives rejected**:

- *A markdown checklist in the spec directory.* Reviewable, but nothing
  stops the page from saying more than the list.

---

## D12 — Security headers and the CSP come from the Worker; stylesheets are never inlined

**Decision**: the Worker (D3) sets `Content-Security-Policy` with
`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'
data:; font-src 'self'; connect-src 'self' <API_ORIGIN>; form-action 'self'
<API_ORIGIN>; frame-ancestors 'none'; base-uri 'self'`, plus
`X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera, microphone, geolocation off) and
`Strict-Transport-Security`. `API_ORIGIN` is a wrangler `var` per
environment. Astro's `build.inlineStylesheets` is `"never"` so no
`<style>` needs a hash.

**Rationale**: FR-027 promises that nothing loads from another origin; a
CSP is that promise enforced by the browser. Astro's own `security.csp`
(measured 2026-09-19: stable since v6) emits a `<meta>` element, which cannot
carry `frame-ancestors`, and "external scripts and external styles are not
supported out of the box". One header in one place, tested in workerd, is
simpler.

**Alternatives rejected**:

- *Astro's `security.csp`.* See above; also splits the policy between a
  build-time meta tag and a runtime header.

---

## D13 — Versions: Astro 7.3 on Vite 8 and Node ≥ 22.12; the landing's tests on Vitest 4.1 with the current Workers pool

**Decision**: `astro@^7.3` (7.3.3 on 2026-09-19; depends on `vite@^8.0.13`;
`engines.node >= 22.12.0`), `@astrojs/check@^0.9`, `@tailwindcss/vite@^4.3`
(peer `vite ^5.2 || ^6 || ^7 || ^8`) and `tailwindcss@^4.3`, matching the
4.3.3 the workspace already resolves. For the landing's own tests —
the Worker script and the claims list — `vitest@^4.1` with
`@cloudflare/vitest-pool-workers@^0.22` (peer `vitest ^4.1.0`). The other
four packages stay on Vitest 3.2.7 and Vite 6.4.3 untouched.

**Rationale**: Astro 7 mandates Vite 8; the workspace's Vitest 3 declares no
support for it. Keeping the landing's Vitest on the version that shares
Astro's Vite avoids two Vites inside one package, and the 0.22 pool pairs
the miniflare that matches the wrangler CI deploys with (4.12x–4.13x). The
split is contained to one package and `pnpm -r test` runs each package's own
script. CI's `node-version: 22` resolves the latest 22.x, above 22.12.

**Alternatives rejected**:

- *Vitest 3.2.7 + pool 0.8.71 in the landing too.* Works — the Worker test
  does not use Astro's Vite config — but installs a second Vite inside the
  package and an older miniflare than the deploy target.
- *Astro 5 (the version this plan's author knows best).* Two majors behind;
  the docs read for this plan are v7's.

---

## D14 — Hosts, origins and the API address

**Decision**: production serves `devoladapago.com` and `www.devoladapago.com`
as custom domains of `devolada-landing` (the Worker redirects `www`, D3);
`dev` serves `dev.devoladapago.com` on `devolada-landing-dev`. Measured
2026-09-19: none of the four hosts (`devoladapago.com`, `www.`, `dev.`,
`www.dev.`) has a DNS record; `custom_domain: true` creates them on first
deploy, as it did for the three existing hosts. The API's `ALLOWED_ORIGINS`
gains the landing origins per environment plus the preview suffix
`*-devolada-landing-dev.devoladapago-14b.workers.dev`; the API gains
`LANDING_BASE_URL` (D6). The page bakes the API address at build from
`PUBLIC_API_URL` — Astro's public-variable prefix — with the same
`http://localhost:8787` fallback the admin uses. Smoke probes read
`DEV_LANDING_URL` / `PROD_LANDING_URL` repository variables.

**Rationale**: the constitution's environments row — `dev` and `prod` per
Worker under the product domain, previews per PR. `dev.devoladapago.com` is
the passkey relying-party id, which is a domain, not a host; serving a page
there conflicts with nothing.

**Alternatives rejected**:

- *Only the apex, `www` left dangling.* A visitor who types `www.` gets an
  error page; the redirect is ten lines.

---

## D15 — The page is dark by default; there is no toggle

**Decision** (amended 2026-09-20 in the design session; the first version
followed `prefers-color-scheme`): the page sets `data-theme="dark"` on its
root and renders the tokens' dark palette for every visitor. No toggle, no
system preference.

**Rationale**: the creator chose it on the canvas and the palette earns it —
on warm charcoal the teal action and the green "pago registrado" moment are
the page's colour, and a stranger reading for ninety seconds does not need a
switch. The tokens already carry the palette and contrast-lint measures it;
the browser layer verifies the page on the palette it renders (FR-028,
SC-006). The light palette stays in the design as a tweak.

---

## D16 — The waiting state reads the shared thresholds from `@devolada/ui/motion`

**Decision**: the two timing constants inside `Pending` —
`FLASH_THRESHOLD_MS = 200` and `MINIMUM_VISIBLE_MS = 500` — move to
`packages/ui/src/lib/motion.ts`, exported as `@devolada/ui/motion`, and
`Pending` imports them from there. The landing's form script applies
`animate-breath` and `aria-busy` to the sending region after the threshold
and keeps it for the minimum, with the copy "Enviando tu solicitud…" carrying
the state.

**Rationale**: constitution VI — waiting breathes, the copy says so, and a
literal duration in a second place is drift. The constants are the recipe;
exporting them keeps one definition without importing React into the page.

**Alternatives rejected**:

- *Repeating `200` and `500` in the landing's script.* The exact drift
  design-foundations D15 recorded and paid.

---

## D17 — The operator's third tab: the counts, the requests, and a file made in the browser

**Decision**: `OperatorScreen` gains a tab "Landing" (`LandingTab.tsx`):
a period picker (7 / 30 / 90 days), one table of counts by channel with
the three steps and their shares of visits, and the requests table newest
first with the WhatsApp, the name, the billing system, which form it came
from, the channel, the arrival time and the notice state (amended
2026-09-20 with D22/D23).
"Exportar CSV" builds the file in the browser from the loaded list.

**Rationale**: FR-017 and FR-024 — one place, the place the operator already
works, no developer. The list is small for the life of this feature; a
server-side export would be an endpoint for a `Blob`.

---

## D18 — The browser layer runs `astro preview`; the Worker is proved in workerd

**Decision**: `playwright.config.ts` adds a third `webServer` — build, then
`astro preview` on port 4176 — and `tests/e2e/landing.spec.ts` covers the
page: the first screen at 360, both themes with axe, targets and the 64px
action, keyboard, no sideways scroll at three widths, the three payer-page
strings, every claim, the form against a stubbed API (received, refused,
limited, unavailable), and a first-visit weight under half a megabyte. The
Worker's redirect, injection and headers are proved by
`apps/landing/test/worker.test.ts` in workerd with a stub `ASSETS` service
binding answering a fixture page. Astro's Container API is not used.

**Rationale**: the browser layer runs static previews by design ("a static
preview starts in seconds instead of booting wrangler"), and `astro
preview` is that preview for a static build. `HTMLRewriter` exists only in
the Workers runtime, so its test runs there — constitution IV, the real
runtime. The Container API is marked experimental "even in minor or patch
releases" (measured 2026-09-19); a CI gate should not stand on it.

---

## D19 — The constitution amendment this plan proposes

**Decision**: a MINOR amendment through `/speckit-constitution`, at the
creator's hand, in the same release as this feature:

1. *Technology Stack & Constraints* gains a row —
   **Landing** | `apps/landing`: Astro (static output, no adapter) on an
   assets Worker with a script in front; consumes `@devolada/ui` tokens,
   stylesheet and recipes at build; ships no client framework.
2. *Principle VI*, the `packages/ui` bullet: "any atom **both surfaces**
   render" → "any atom **more than one surface** renders", and the sentence
   that follows it likewise. The rule does not change; its count does.
3. The *Tests* row, which names Vitest 3: "Vitest 3 (Vitest 4 in
   `apps/landing`, whose Astro build sits on Vite 8, until the workspace
   moves)". The table describes the product as built or it is not the law.

**Rationale**: governance — a plan that departs from the stack table
justifies it in Complexity Tracking, and a rule the code will now hold
three surfaces to should say so.

**Ready to paste** (drafted 2026-09-19 after `/speckit-analyze` finding C1;
the creator runs `/speckit-constitution` with it — MINOR, 1.4.0 → 1.5.0):

1. *Technology Stack & Constraints* — a new row after **Shared UI**:

   ```text
   | Landing | `apps/landing`: Astro (static output, no adapter) on an assets Worker with a script in front for the host redirect, the channel tag and the headers; consumes `@devolada/ui` tokens, stylesheet, atoms and recipes at build; ships no client framework |
   ```

2. *Technology Stack & Constraints* — the **Tests** row, "Vitest 3" becomes:

   ```text
   Vitest 3 (Vitest 4 in `apps/landing`, whose Astro build sits on Vite 8, until the workspace moves)
   ```

3. *Principle VI* — the `packages/ui` bullet. Replace

   ```text
   `packages/ui` is the single definition of any atom both surfaces render; a duplicate recipe in an app is drift.
   ```

   with

   ```text
   `packages/ui` is the single definition of any atom more than one surface renders; a duplicate recipe in an app is drift. A surface that ships no client framework consumes the atoms rendered at build and the recipes as class strings — the definition stays in the package either way.
   ```

   The rest of the bullet ("Sizes are declared, not improvised…", "Primitives
   only one surface uses…") stays as written.

4. *Sync Impact Report* — source `specs/008-landing-page` (plan Complexity
   Tracking; research D2, D13, D19). What this decides: a third surface
   exists and the law counts it. What it does not change: no principle
   added, removed or redefined; no renumbering; templates unchanged; the
   TD-005 and BREATH-AMPLITUDE TODOs carried unchanged.

---

## D20 — The privacy notice: what Mexican law asks for, and placeholders that refuse to publish

**Decision**: `/privacidad` carries the sections the LFPDPPP and its
guidelines require of a full notice: the identity and address of the
responsible party, the data collected (the WhatsApp number and, when given,
the name and the billing system — amended 2026-09-20 with D23), the purposes
(answering the request; no secondary purpose), that no
transfer is made, how to exercise access, correction, cancellation and
opposition and how to revoke consent (the contact address), and how changes
are announced. A short notice sits beside the form's send button and links
to the full one (FR-022). The responsible party's name and address are the
creator's to give: `apps/landing/src/content/legal.ts` holds them as
`{{RESPONSABLE}}` and `{{DOMICILIO}}`, and `content.test.ts` fails while
either remains.

**Rationale**: a form that collects a person's name and phone in Mexico
carries a notice or it is not lawful to collect; which legal person answers
for it is not the plan's decision.

---

## D21 — Brand assets: the mark the admin already has, and an image exported by hand

**Decision**: `apps/landing/public/favicon.svg` is the mark from
`apps/admin/public/icon.svg`; `public/og.png` (1200×630) is exported once
from a committed `og.svg` and regenerated by hand when the wordmark changes.
No build-time renderer.

**Rationale**: FR-031 needs one image; a dependency to rasterise it in CI
would be the heaviest thing in the package.

---

## D22 — One action on the page; sign-up is step 3 of the conversation

**Decision** (design session 2026-09-20; spec Clarifications of that date):
the page asks for one thing, the reader's WhatsApp — a one-field form in the
first screen, a three-field form at the end — and carries no link to the
product's sign-up. The header links to sign-in for customers who already have
an account. Sign-up happens inside the WhatsApp conversation, sent by the
creator when the prospect is a fit, as step 3 of the activation workflow the
spec now carries. The `signup` beacon step, the `a[data-signup]` rewrite in
the Worker and the second closing card are gone.

**Rationale**: an account without a CLABE, a connected system and a first
link is an empty room — for a business whose system is not supported, empty
by construction — so self-serve sign-ups from the page would have been noise
in the numbers and dead rows in the panel. At this stage the conversation is
where activation happens and where validation data comes from; one action
gives one honest rate to watch. The exposure accepted on 2026-09-19 stands:
sign-up is one click behind sign-in.

**Alternatives rejected**:

- *Two doors (the 2026-09-19 answer).* Split attention, two mediocre rates,
  and accounts nobody activates.
- *Sign-up as the only action.* Dead on arrival for every business without
  the supported system, and no conversation to learn from.

---

## D23 — Three fields, the WhatsApp required; which form sent it is recorded

**Decision** (design session 2026-09-20): the request carries the WhatsApp
number (required, `WHATSAPP_PATTERN`), and optionally the person's name and
the billing system (`BILLING_SYSTEMS`: the supported one, own software,
another, none yet). No email, no business name, no size band, no note. The
row records `form`: `hero` (the one-field form) or `full` (the closing form),
so the operator can tell which form converts. The "same person asked twice"
mark keys on the WhatsApp number.

**Rationale**: the creator asks the rest in the chat (workflow step 2), and
every field removed from a phone form is a request not abandoned. The
billing-system answer stays because it is the one question that decides
which door step 3 opens.

**Alternatives rejected**:

- *Keeping email as an alternative contact.* The reader is on WhatsApp; a
  second channel is a second place for the creator to look.
- *Keeping the size band.* Asked in the chat, where the answer comes with
  context.

---

## D24 — The reader is the ISP; platforms come second, through the API and a page of their own

**Decision** (second design session, 2026-09-20): the page speaks to ISPs
and says so in its first line, *Cobros por SPEI para ISPs en México*; where
it said *servicio* it says *internet*. It still names no vendor (the
2026-09-20 clarification stands). Platforms — billing systems and software
vendors who would integrate `/v1` to offer verified SPEI to their own
users — are the second customer and get their own page when the first ISPs
have converted; this page carries no line for them.

**Rationale**: the promise the page makes in three moments is true end to
end only for an ISP whose system Devolada talks to; a reader who sees *Pago
de internet* and *Reconectado* and recognises their own week is the ISP
owner. A platform is a different buyer who reads documentation, has a
different conversation, and would dilute this one. *ISP* stays wider than
the one system integrated today: the form's billing-system answer and the
conversation are how the creator learns which system to build next, and
naming a vendor would narrow the page to that vendor's users.

**Alternatives rejected**:

- *"ISPs y negocios", as the first canvas said.* Two readers, one page;
  the second reader gets a promise the product only keeps through the API.
- *One footer line for platforms.* Cheap, but it is what focus gives up;
  a platform that arrives picks *Mi propio sistema* and is answered in
  the chat.
- *Naming the integrated system.* Reads as one vendor's add-on and loses
  every ISP on another system, the very demand the page should count.

---

## D25 — A payment shown as three moments; the customer's screen moves inside it

**Decision** (second design session, 2026-09-20): the section after the
proof tiles, *Lo que pasa cuando te pagan*, shows one payment as three
numbered moments on a rail: *Tu cliente paga* (the payment screen: amount,
CLABE ending), *Se verifica la transferencia* (that screen at its two
moments — *Verificando tu pago…* breathing, then the green *Tu pago fue
registrado.*), *El internet vuelve solo* (the business's system: a customer
row with the `StatusBadge` *Reconectado*). It replaces the customer's
screen shown alone (FR-006 amended). *Tu servicio sigue activo* leaves the
page, and `customer-meanwhile` leaves the claims list (D11). The hero form
drops its tinted panel: field label, input, the 64 px button as the one
accent, one help line, a hairline before the customer's line.

**Rationale**: the reader asked for the automation, not the screen. Three
moments across two screens — the customer's phone, then the business's
system — is the automation; the screen alone was one side of it. *Tu
servicio sigue activo* is the payer page's line for a customer who was never
cut (`PaymentPage.tsx`, the `protect` release) and contradicted a story that
ends in a reconnection. The panel around the hero form was a second accent
competing with the button inside it.

**Measured 2026-09-20**: with Archivo loaded, the phone page runs to
5,172 px and the desktop page to 3,611 px; the boards had been 4,440 and
3,320 and were clipping the footer. They are now 5,200 and 3,640. The
browser test's no-clipping check is the page itself, which has no fixed
height; the boards are the design's frames.

**Alternatives rejected**:

- *Timestamps on the moments (14:20 → 14:21).* Implies a speed the page
  cannot promise; verification can take hours (the *¿Cuánto tarda?* doubt).
- *A third numbered list styled like "Cómo funciona".* Two numbered lists
  already sit on the page; this one carries screens, which is what makes it
  a scene rather than a list.
- *Keeping the tinted panel with a lighter tint.* Still two accents.

---

## Carried, not resolved here

- **"Crear cuenta" on the page**, with the channel tag recorded at account
  creation when it returns — the spec's *Deferred* names the three triggers.
- **Retrying a failed notification** from the sweep (D10) if failures ever
  cluster.
- **A messaging button** beside the form, when the creator decides to
  publish a number.
- **A generic analytics product beside the beacon** — none is needed for
  the spec's questions; if traffic sources beyond the tag ever matter,
  Cloudflare Web Analytics is cookieless and would join through the CSP.
