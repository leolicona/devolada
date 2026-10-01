import { QueryClient } from "@tanstack/react-query";

/* One cache for the app, on the module so the tests can empty it after
   each case (constitution IV: a test starts from empty). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
