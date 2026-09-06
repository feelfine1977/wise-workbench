import createClient from "openapi-fetch";
import type { paths, Problem } from "@wise/api-schema";
import { apiBase } from "./config";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  constructor(status: number, problem?: Problem, fallback?: string) {
    super(problem?.title ?? problem?.detail ?? fallback ?? `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

// fetch is looked up per call so test interceptors (MSW in Node) that patch globalThis.fetch after
// module load still see every request.
export const api = createClient<paths>({ baseUrl: apiBase, fetch: (input) => globalThis.fetch(input) });

/** Unwraps an openapi-fetch result: returns `data`, throws `ApiError` on `error`. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const problem = (result.error ?? undefined) as Problem | undefined;
    throw new ApiError(result.response.status, problem);
  }
  return result.data as T;
}
