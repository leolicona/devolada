import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/* Same ceiling as the PWA: parallel test files make the first render in
   each file slow, and the 1s default fails whichever file loses the race
   (docs/TESTING.md). */
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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
