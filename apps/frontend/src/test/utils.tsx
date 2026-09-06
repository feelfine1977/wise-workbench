import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import axe from "axe-core";
import { expect } from "vitest";
import { App } from "@/app/providers";

export function makeTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 }, mutations: { retry: false } } });
}

/** Renders the whole app at a route on a memory history (mocks answer the API). */
export function renderApp(path = "/"): RenderResult & { queryClient: QueryClient } {
  const queryClient = makeTestQueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const result = render(<App queryClient={queryClient} history={history} />);
  return { ...result, queryClient };
}

/** Runs axe on a container and fails on serious or critical violations; lesser ones are reported. */
export async function expectNoSeriousA11yViolations(container: Element) {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not compute layout; colour contrast is verified by the token build instead.
      "color-contrast": { enabled: false },
      // the shell's main landmark is rendered per route; not every isolated component has one.
      region: { enabled: false },
    },
  });
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const describe = (v: axe.Result) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.html).join("\n  ")}`;
  if (results.violations.length && !serious.length) {
    console.info("axe minor findings:\n" + results.violations.map(describe).join("\n"));
  }
  expect(serious.map(describe), "serious axe violations").toEqual([]);
}
