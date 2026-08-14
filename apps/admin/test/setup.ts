import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/* Same ceiling as the PWA: parallel test files make the first render in
   each file slow, and the 1s default fails whichever file loses the race
   (docs/TESTING.md). */
configure({ asyncUtilTimeout: 5000 });
import { server } from "./msw";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
