import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

/* API-layer tests (docs/legacy/TESTING.md): the Hono app runs in workerd — the
   real Workers runtime — with a real local D1, no database mocks.
   Migrations are read here and applied per test in test/setup.ts. */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      setupFiles: ["./test/setup.ts"],
      poolOptions: {
        workers: {
          /* One workerd runtime for the whole suite (tests keep isolated
             storage). Per-file runtimes exhausted the ephemeral port
             space once Better Auth's module graph joined the suite —
             measured locally: 15 parallel runtimes → 16k TIME_WAIT
             sockets and "Fallback service ... Connection refused". */
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              /* Pinned, not defaulted: `wrangler.configPath` above also
                 loads .dev.vars, and the queue and direct-payment paths
                 pass this straight to the adapter. A developer pointing
                 it at a local WispHub clone would send their provider
                 calls there instead of to the interceptor, failing the
                 suite on their machine alone. The tests mock this
                 origin. */
              WISPHUB_BASE_URL: "https://api.wisphub.net/api",
              /* Same rule for the validation engine's provider
                 (consta-api-merge D12, constitution IV): a developer
                 running the apiCEP sandbox has
                 APICEP_BASE_URL=http://localhost:8789 in .dev.vars, and
                 without the pin every provider test would go there. The
                 token must be *present* — the channel is available in
                 tests — and the value never reaches a real host. */
              APICEP_BASE_URL: "https://api.apicep.cloud",
              APICEP_TOKEN: "test-apicep-token",
              /* cep-bundle-match D16: the bundle's storage origin, pinned
                 for the same reason — `.dev.vars` points it at the
                 sandbox, and a suite that downloads a ZIP must meet the
                 interceptor at the real origin. */
              APICEP_STORAGE_ORIGIN: "https://storage.apicep.cloud",
              /* Same rule for the email provider: .dev.vars carries a real
                 key on a developer's machine, and without this pin every
                 seeded signup's OTP reached Resend for real (measured
                 2026-09-01: 429s in the test output). Empty = log only. */
              RESEND_API_KEY: "",
              /* receipt-reader-tuning D7, D11 (constitution IV): the reader's
                 models are pinned like the providers' origins, so a
                 developer's .dev.vars — or the dev list in wrangler.jsonc —
                 can never move a suite. The default is Mistral because
                 validate.test.ts asserts its id on a row; `@cf/test/other`
                 is a second model that exists only for the stub to answer
                 as; 50 ms keeps the fallback's time limit fast to reach. */
              EXTRACTION_MODEL: "@cf/mistralai/mistral-small-3.1-24b-instruct",
              EXTRACTION_MODELS: JSON.stringify([
                { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Default" },
                { id: "@cf/test/other", label: "Other" },
              ]),
              READER_TIMEOUT_MS: "50",
              /* better-auth.spec.md D11: the suite signs in hundreds of
                 times from one address; the limiter's own test hands the
                 app an env without this pin. */
              AUTH_RATE_LIMIT: "off",
              /* passwordless-access D10 (adversarial review, 2026-10-02):
                 every refusal of POST /store/sign-in waits out a floor of
                 at least 1 s; the suite types many wrong códigos there, so
                 it pins none (0 turns the floor off, the scaling with D1's
                 round trip included), and the floor's own tests hand the
                 app a value. */
              STORE_SIGN_IN_FLOOR_MS: "0",
              /* landing-page D6: the landing's address, so the request
                 door's redirect answer can be asserted. A test that wants
                 the unset behaviour — the envelope for a plain form post —
                 strips it from the env the way rate-limit.test.ts strips
                 AUTH_RATE_LIMIT. */
              LANDING_BASE_URL: "https://landing-test.devolada.internal",
              /* automated-collections-api D8/D10: every webhook test
                 registers this fixed origin as its destination and
                 intercepts it with fetchMock, rather than each file
                 inventing its own URL — pinned here so a developer's
                 .dev.vars can never redirect a delivery out of the suite. */
              WEBHOOK_TEST_DESTINATION_URL: "https://webhook-test.devolada.internal/hook",
              /* Fixed ES256 test key pair for WEBHOOK_SIGNING_KEYS
                 (research D10): a JSON array of private JWKs, the shape
                 `webhooks/sign.ts` parses. Generated once and hardcoded —
                 not regenerated per run — so a test can hardcode the
                 `kid` it expects and a developer's .dev.vars can never
                 swap the key the tests verify signatures against. */
              WEBHOOK_SIGNING_KEYS: JSON.stringify([
                {
                  key_ops: ["sign"],
                  ext: true,
                  kty: "EC",
                  x: "dnEwnkxFCdUTYJR6SmCCSu_ukm7-OzOEx1dKF593rjw",
                  y: "ySSweX0hnPosuOcJ_cFaAqt-Rzf2V8b2TjTBEUgWnYI",
                  crv: "P-256",
                  d: "mhM346PEc7G77U6ndRmb-3ruYU93IfT_7RUQeXNJbGc",
                  kid: "test-2026-09-17",
                },
              ]),
            },
          },
        },
      },
    },
  };
});
