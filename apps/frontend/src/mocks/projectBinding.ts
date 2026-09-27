import { http, HttpResponse } from "msw";
import type { ProjectDatasetBinding } from "@/lib/api/projectBinding";
import { db } from "./db";

// Project object identity makes resetDb reset bindings too. All fixture projects start unbound.
const bindings = new WeakMap<object, ProjectDatasetBinding>();
const endpoint = "*/api/v1/projects/:projectId/dataset-binding";
const problem = (status: number, code: string, detail: string) => HttpResponse.json({ type: `urn:wise-workbench:problem:${code}`, title: detail, status, detail, code, errors: [] }, { status });
export const projectBindingHandlers = [
  http.get(endpoint, ({ params }) => {
    const project = db.projects.find((p) => p.id === params.projectId);
    if (!project) return problem(404, "project.not_found", "Project not found.");
    return HttpResponse.json(bindings.get(project) ?? { projectId: project.id, datasetId: null, boundAt: null });
  }),
  http.put(endpoint, async ({ params, request }) => {
    const project = db.projects.find((p) => p.id === params.projectId);
    if (!project) return problem(404, "project.not_found", "Project not found.");
    const body = await request.json() as Record<string, unknown> | null;
    if (!body || Object.keys(body).length !== 1 || typeof body.datasetId !== "string" || !/^\S{1,200}$/.test(body.datasetId)) return problem(422, "request.invalid", "A datasetId is required.");
    // The mock store exposes one project-local dataset collection, like its dataset list handler.
    const dataset = db.datasets.find((d) => d.id === body.datasetId);
    if (!dataset) return problem(404, "dataset.not_found", "Dataset not found in this project.");
    const saved = bindings.get(project);
    if (saved) return saved.datasetId === dataset.id ? HttpResponse.json(saved) : problem(409, "project.dataset_already_bound", "This project already has a fixed dataset. Create a new project to use another dataset.");
    if (dataset.status !== "ready") return problem(409, "project.dataset_not_ready", "Wait for a successful dataset import.");
    const next = { projectId: project.id, datasetId: dataset.id, boundAt: new Date().toISOString() };
    bindings.set(project, next);
    return HttpResponse.json(next);
  }),
];
