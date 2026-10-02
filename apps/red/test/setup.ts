import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { server } from "./msw";
import { queryClient } from "../src/lib/query";
import { atWidth } from "./viewport";

/* Same ceiling as the other apps: parallel test files race for the CPU
   on their first render. */
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
/* cash-at-stores D32: a test starts on the phone the app is designed at
   (375px). happy-dom's own default is 1024px — the desktop layout — so
   a desktop case asks for it with `atWidth(1280)`. */
beforeEach(() => atWidth(375));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  /* A test starts from empty (constitution IV). The query cache lives on
     the module, not on the tree, so unmounting does not empty it. */
  queryClient.clear();
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* no store in this environment */
  }
});
afterAll(() => server.close());
