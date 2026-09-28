/** Release only this application's MSW registration before making live API requests. */
export async function prepareLiveBackend(
  serviceWorkers: ServiceWorkerContainer | undefined,
  location: Pick<Location, "origin" | "reload">,
): Promise<boolean> {
  if (!serviceWorkers) return true;
  const isMockWorker = (worker: ServiceWorker | null | undefined) => {
    if (!worker) return false;
    const url = new URL(worker.scriptURL);
    return url.origin === location.origin && url.pathname === "/mockServiceWorker.js";
  };
  const controlledByMocks = isMockWorker(serviceWorkers.controller);
  if (controlledByMocks) serviceWorkers.controller!.postMessage("MOCK_DEACTIVATE");
  const registrations = await serviceWorkers.getRegistrations();
  await Promise.all(registrations.filter(registration =>
    [registration.active, registration.waiting, registration.installing].some(isMockWorker),
  ).map(registration => registration.unregister()));
  if (controlledByMocks) {
    // Unregister does not release an already controlled document. Reload before mounting queries.
    location.reload();
    return false;
  }
  return true;
}
