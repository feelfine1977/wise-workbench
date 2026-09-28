import { http, HttpResponse } from "msw";
import { db } from "./db";

export const datasetCatalogueHandlers = [
  http.get("*/api/v1/projects/:projectId/dataset-catalogue", () => HttpResponse.json({
    projects: db.projects.map((p) => ({ id: p.id, name: p.name, process: p.process, datasets: (p.id === db.projects[0]?.id ? db.datasets : []).map((d) => ({ id: d.id, name: d.name, status: d.status, events: d.events ?? null })) })),
    workspaces: [],
    imports: [],
    warning: null,
  })),
];
