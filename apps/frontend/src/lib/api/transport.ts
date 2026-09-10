/** Shared fetch transport; request encoding and error behavior are unchanged. */
import type { Problem } from "@wise/api-schema";
import { ApiError } from "@/lib/api";
import { apiBase } from "@/lib/config";

async function problemOf(res: Response): Promise<Problem | undefined> {
  try {
    return (await res.json()) as Problem;
  } catch {
    return undefined;
  }
}

async function request<T>(method: string, path: string, init: { body?: unknown; form?: FormData; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const url = new URL(`${apiBase}${path}`);
  // An empty filter is still selection input: dropping it would silently request the whole group.
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && (v !== "" || k === "filter")) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await globalThis.fetch(url.toString(), { method, headers, body });
  if (!res.ok) throw new ApiError(res.status, await problemOf(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string, query?: Record<string, string | number | undefined>) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, query?: Record<string, string | number | undefined>) => request<T>("POST", path, { body, query }),
  postForm: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  put: <T>(path: string, body: unknown, query?: Record<string, string | number | undefined>) => request<T>("PUT", path, { body, query }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
