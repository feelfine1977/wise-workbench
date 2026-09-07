import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { projectsQuery } from "@/lib/queries";
import { AppShell } from "./shell/AppShell";
import { NotFound } from "./NotFound";
import { parseSearch, stringifySearch, validateActSearch, validateBacklogSearch, validateBoardSearch, validateDatasetSearch, validateFlowSearch, validateKnowledgeSearch, validateNormSearch, validateNotebookSearch, validateRunSearch, validateSliceSearch } from "./search";
import { LoadingBlock } from "@/components/states";

export const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const projects = await context.queryClient.ensureQueryData(projectsQuery);
    const first = projects[0];
    if (first) throw redirect({ to: "/p/$projectId", params: { projectId: first.id } });
    throw redirect({ to: "/projects" });
  },
});

export const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: lazyRouteComponent(() => import("@/routes/ProjectsPage")),
});

export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: AppShell,
});

export const dashboardRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: lazyRouteComponent(() => import("@/routes/DashboardPage")),
});

export const dataRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "data",
  component: lazyRouteComponent(() => import("@/routes/data/DataPage")),
});

export const datasetRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "data/$datasetId",
  validateSearch: validateDatasetSearch,
  component: lazyRouteComponent(() => import("@/routes/data/DatasetPage")),
});

export const normsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "norms",
  component: lazyRouteComponent(() => import("@/routes/norms/NormsPage")),
});

export const normRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "norms/$normVersionId",
  validateSearch: validateNormSearch,
  component: lazyRouteComponent(() => import("@/routes/norms/NormPage")),
});

export const runsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs",
  component: lazyRouteComponent(() => import("@/routes/runs/RunsPage")),
});

export const runRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId",
  validateSearch: validateRunSearch,
  component: lazyRouteComponent(() => import("@/routes/runs/RunPage")),
});

export const backlogRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId/backlog",
  validateSearch: validateBacklogSearch,
  component: lazyRouteComponent(() => import("@/routes/backlog/BacklogPage")),
});

export const flowRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId/flow",
  validateSearch: validateFlowSearch,
  component: lazyRouteComponent(() => import("@/routes/flow/FlowPage")),
});

export const boardRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId/board",
  validateSearch: validateBoardSearch,
  component: lazyRouteComponent(() => import("@/routes/board/BoardPage")),
});

export const sliceRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId/slices/$sliceKey",
  validateSearch: validateSliceSearch,
  component: lazyRouteComponent(() => import("@/routes/slice/SlicePage")),
});

/** The seventh step of one group: *What can we do?* (R3-01). */
export const actRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "runs/$runId/slices/$sliceKey/act",
  validateSearch: validateActSearch,
  component: lazyRouteComponent(() => import("@/routes/act/ActPage")),
});

/** The knowledge hub: the index, and a page per node (R3-05). */
export const knowledgeRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "knowledge",
  validateSearch: validateKnowledgeSearch,
  component: lazyRouteComponent(() => import("@/routes/knowledge/KnowledgeHubPage")),
});

export const hubNodeRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "knowledge/$nodeId",
  component: lazyRouteComponent(() => import("@/routes/knowledge/HubNodePage")),
});

export const notebookRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "notebook",
  validateSearch: validateNotebookSearch,
  component: lazyRouteComponent(() => import("@/routes/notebook/NotebookPage")),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsRoute,
  projectRoute.addChildren([dashboardRoute, dataRoute, datasetRoute, normsRoute, normRoute, runsRoute, runRoute, backlogRoute, flowRoute, boardRoute, actRoute, sliceRoute, knowledgeRoute, hubNodeRoute, notebookRoute]),
]);

export function createAppRouter(queryClient: QueryClient, history?: Parameters<typeof createRouter>[0]["history"]) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // The first click on a screen whose code has not loaded yet shows a skeleton at once (R2-O4).
    defaultPendingMs: 50,
    defaultPendingMinMs: 200,
    defaultPendingComponent: () => <LoadingBlock rows={6} className="p-4" />,
    scrollRestoration: true,
    parseSearch,
    stringifySearch,
    history,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
