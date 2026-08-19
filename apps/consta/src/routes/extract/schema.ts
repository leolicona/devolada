import { z } from "zod";

/* D6 — `POST /extract` returns the reading and spends no apiCEP credit.
   The receipt door of `/validate` calls the same reader; this endpoint
   exists so an integrator can show a customer what was read *before*
   money moves. A single endpoint cannot hold a human. */
export const extractRequestSchema = z.object({
  receiptUrl: z.string().url(),
});
