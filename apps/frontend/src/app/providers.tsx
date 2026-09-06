import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/i18n";
import { createAppRouter } from "./router";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
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
