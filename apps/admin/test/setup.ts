import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/* Same ceiling as the PWA: parallel test files make the first render in
   each file slow, and the 1s default fails whichever file loses the race
   (docs/legacy/TESTING.md). */
configure({ asyncUtilTimeout: 5000 });

/* Radix Select opens on pointerdown and asks the DOM for pointer capture
   and scrollIntoView, which happy-dom does not implement. Stubs, so a
   test can open a picker the way a person does (memberships tests). */
const proto = Element.prototype as Element & {
  hasPointerCapture?: (id: number) => boolean;
  setPointerCapture?: (id: number) => void;
  releasePointerCapture?: (id: number) => void;
  scrollIntoView?: () => void;
};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};
import { server } from "./msw";
import * as authClient from "../src/lib/auth-client";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  /* passwordless-access D7: the platform check is asked once per page load.
     A file that mocks the client has no such memory to forget (and vitest
     throws on an export its mock does not define). */
  try {
    authClient.resetCanVerifyPerson();
  } catch {
    /* mocked in this file */
  }
  /* A test starts from empty or it is not a test (constitution IV).
     Links remembers its search, the customers it saw and the rows the
     operator copied in `sessionStorage` (links-on-demand-search D11),
     and module state outlives a render. */
  try {
    sessionStorage.clear();
  } catch {
    /* no store in this environment */
  }
});
afterAll(() => server.close());
