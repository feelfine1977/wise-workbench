import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { createAppRouter } from "./router";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        /**
         * A request the server has refused will be refused again (R3-12): a 4xx is the answer, not a hiccup,
         * and retrying it only keeps the screen on its skeleton for twice as long. A pasted address whose
         * filter carries a clause this run does not know returns its 422 in eleven milliseconds; the screen
         * must end on a sentence, not wait for a second refusal.
         */
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

export function App({ queryClient, history }: { queryClient: QueryClient; history?: Parameters<typeof createAppRouter>[1] }) {
  const router = useMemo(() => createAppRouter(queryClient, history), [queryClient, history]);
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
