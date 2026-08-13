import { applyD1Migrations, env } from "cloudflare:test";

/* Isolated storage gives every test a fresh D1; migrations run before each. */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
