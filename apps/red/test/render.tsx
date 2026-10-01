import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { router as appRouter } from "../src/router";
import { queryClient } from "../src/lib/query";

/* The whole app at a path, on its own memory history and the module's
   query cache (emptied after every test in setup.ts) */
export function renderApp(path: string) {
  const router = createRouter({
    routeTree: appRouter.options.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

export { atWidth } from "./viewport";
