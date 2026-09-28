import { describe, expect, it, vi } from "vitest";
import { prepareLiveBackend } from "./liveBackend";

function worker(script = "http://localhost/mockServiceWorker.js") {
  return { scriptURL: script, postMessage: vi.fn() } as unknown as ServiceWorker;
}
function registration(active: ServiceWorker | null, extra = {}) {
  return { active, waiting: null, installing: null, unregister: vi.fn().mockResolvedValue(true), ...extra } as unknown as ServiceWorkerRegistration;
}
function setup(registrations: ServiceWorkerRegistration[], controller: ServiceWorker | null = null) {
  return {
    workers: { controller, getRegistrations: vi.fn().mockResolvedValue(registrations) } as unknown as ServiceWorkerContainer,
    location: { origin: "http://localhost", reload: vi.fn() },
  };
}

describe("switching a browser from fixtures to the live backend", () => {
  it("continues when service workers are unavailable", async () => {
    const { location } = setup([]);
    expect(await prepareLiveBackend(undefined, location)).toBe(true);
    expect(location.reload).not.toHaveBeenCalled();
  });
  it("unregisters only this origin's exact MSW script, including waiting/installing workers", async () => {
    const active = registration(worker());
    const waiting = registration(null, { waiting: worker("http://localhost/mockServiceWorker.js?v=2") });
    const installing = registration(null, { installing: worker() });
    const other = registration(worker("http://localhost/offlineWorker.js"));
    const foreign = registration(worker("https://other.example/mockServiceWorker.js"));
    const nested = registration(worker("http://localhost/another-app/mockServiceWorker.js"));
    const { workers, location } = setup([active, waiting, installing, other, foreign, nested]);
    expect(await prepareLiveBackend(workers, location)).toBe(true);
    for (const row of [active, waiting, installing]) expect(row.unregister).toHaveBeenCalledOnce();
    for (const row of [other, foreign, nested]) expect(row.unregister).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });
  it("deactivates and releases the old controller before any live queries can mount", async () => {
    const old = worker();
    const row = registration(old);
    let release!: (result: boolean) => void;
    vi.mocked(row.unregister).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const { workers, location } = setup([row], old);
    const prepared = prepareLiveBackend(workers, location);
    await vi.waitFor(() => expect(row.unregister).toHaveBeenCalledOnce());
    expect(old.postMessage).toHaveBeenCalledWith("MOCK_DEACTIVATE");
    expect(location.reload).not.toHaveBeenCalled();
    release(true);
    expect(await prepared).toBe(false);
    expect(location.reload).toHaveBeenCalledOnce();
    // The next document has no old controller: cleanup does not create a reload loop.
    expect(await prepareLiveBackend(setup([]).workers, location)).toBe(true);
    expect(location.reload).toHaveBeenCalledOnce();
  });
  it("also releases an already-unregistered controller but does not reload unrelated controllers", async () => {
    const stale = setup([], worker());
    expect(await prepareLiveBackend(stale.workers, stale.location)).toBe(false);
    const other = setup([], worker("http://localhost/offlineWorker.js"));
    expect(await prepareLiveBackend(other.workers, other.location)).toBe(true);
    expect(other.location.reload).not.toHaveBeenCalled();
  });
  it("refuses to mount live queries when cleanup fails", async () => {
    const row = registration(worker());
    vi.mocked(row.unregister).mockRejectedValue(new Error("blocked"));
    const { workers, location } = setup([row], row.active);
    await expect(prepareLiveBackend(workers, location)).rejects.toThrow("blocked");
    expect(location.reload).not.toHaveBeenCalled();
  });
});
