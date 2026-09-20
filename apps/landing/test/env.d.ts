import type { Env as WorkerEnv } from "../worker";

/* The pool (v0.22, Vitest 4) types `env` as the global `Cloudflare.Env`;
   this is the Worker's own binding shape, declared once in worker/index.ts. */
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
