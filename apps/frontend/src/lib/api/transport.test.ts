import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { http } from "./transport";

afterEach(() => vi.unstubAllGlobals());

describe("shared request compatibility", () => {
  it("looks up fetch per call and omits empty/undefined query values without losing zero", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await http.get("/probe", { blank: "", missing: undefined, zero: 0, value: "a & b" })).toEqual({ ok: true });
    const [raw, init] = fetch.mock.calls[0]!;
    const url = new URL(raw as string);
    expect([...url.searchParams]).toEqual([["zero", "0"], ["value", "a & b"]]);
    expect(init).toEqual({ method: "GET", headers: {}, body: undefined });
    const later = vi.fn().mockResolvedValue(Response.json({ later: true }));
    vi.stubGlobal("fetch", later);
    expect(await http.get("/probe")).toEqual({ later: true });
    expect(later).toHaveBeenCalledOnce();
  });

  it.each(["post", "patch", "put"] as const)("preserves %s JSON and POST-only idempotency", async (method) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "record" }));
    vi.stubGlobal("fetch", fetch);
    await http[method]("/probe", { count: 0, omitted: undefined, empty: "" });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe(method.toUpperCase());
    expect(init.body).toBe('{"count":0,"empty":""}');
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    if (method === "post") expect(headers["Idempotency-Key"]).toMatch(/^[\da-f-]{36}$/i);
    else expect(headers).not.toHaveProperty("Idempotency-Key");
  });

  it("leaves multipart boundaries to fetch and returns undefined for 204", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const form = new FormData(); form.append("payload", "{}");
    expect(await http.postForm("/probe", form)).toBeUndefined();
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.headers).toHaveProperty("Idempotency-Key");
    expect(await http.delete("/probe")).toBeUndefined();
    expect(fetch.mock.calls[1]![1]).toEqual({ method: "DELETE", headers: {}, body: undefined });
  });

  it.each([true, false])("preserves errors with JSON problem=%s", async (json) => {
    const problem = { title: "Cannot apply", detail: "Reason", status: 422 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json ? Response.json(problem, { status: 422 }) : new Response("not json", { status: 422 })));
    const error = await http.get("/probe").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, message: json ? "Cannot apply" : "Request failed (422)", problem: json ? problem : undefined });
  });
});
