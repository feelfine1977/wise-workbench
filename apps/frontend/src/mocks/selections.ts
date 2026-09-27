import { http, HttpResponse } from "msw";
/** Saved cohorts are supplied explicitly by feature tests; demo fixtures start without saves. */
export const selectionHandlers = [http.get("*/api/v1/projects/:projectId/case-tables/:caseTableId/selections", () => HttpResponse.json([]))];
