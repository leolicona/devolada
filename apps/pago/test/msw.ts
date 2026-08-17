import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

/* Handlers honor the API envelope ({ success, data } | { success, error })
   — mocks that lie are worse than no mocks (TESTING.md rule 5). */

export const ok = (data: unknown, status = 200) =>
  HttpResponse.json({ success: true, data }, { status });

export const fail = (code: string, status: number) =>
  HttpResponse.json({ success: false, error: { code } }, { status });

export const handlers = {
  link: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/direct-payments/links/:token", () => r()),
  pay: (r: (body: unknown) => ReturnType<typeof ok | typeof fail>) =>
    http.post("/direct-payments/links/:token/pay", async ({ request }) =>
      r(await request.json()),
    ),
  proof: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.post("/direct-payments/links/:token/proof", () => r()),
  status: (r: () => ReturnType<typeof ok | typeof fail>) =>
    http.get("/direct-payments/:id/status", () => r()),
};

export const server = setupServer();
