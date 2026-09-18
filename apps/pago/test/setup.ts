import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { server } from "./msw";
import { queryClient } from "../src/App";

/* Same ceiling as the other apps (TESTING.md rule 7): parallel test
   files race for the CPU on their first render. */
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  /* The query cache lives on the module, not on the tree, so unmounting
     does not empty it. A screen that mounts against the previous
     scenario's cached answer freezes its initial state from it. */
  queryClient.clear();
});
afterAll(() => server.close());
