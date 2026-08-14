import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { server } from "./msw";

/* Test files run in parallel, so the first render in each one competes
   for the CPU with every other file's first render and can take several
   seconds on a loaded machine. The 1s default made whichever file lost
   that race fail; the wait is a ceiling, not a delay, so a query that
   never resolves still fails — just later. */
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
