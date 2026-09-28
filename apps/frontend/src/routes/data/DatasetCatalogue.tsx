import { useState } from "react";
import { useTrackJob } from "@/app/shell/JobTray";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { datasetCatalogueQuery, useImportCatalogueDataset, type DatasetCatalogue as Catalogue } from "@/lib/api/dataset-catalogue";
import { fmtInt } from "@/lib/format";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/misc";

function PublishedContext({ context }: { context: Catalogue["imports"][number]["context"] }) {
  if (!context) return null;
  return <div className="my-2 text-xs text-text-muted">
    <p>{context.processDescription}</p>
    <details className="mt-2">
      <summary className="cursor-pointer font-medium">{context.challengeDescription ? "Official challenge and sources" : "Dataset source"}</summary>
      {context.challengeDescription && <p className="my-2">{context.challengeDescription}</p>}
      {!context.challengeDescription && <p className="my-2">The publisher describes this process; no official challenge question is recorded here.</p>}
      <ul className="space-y-1">
        {context.sources.map((source) => <li key={source.url}><a className="text-accent-text underline" href={source.url} target="_blank" rel="noreferrer">{source.title}: {context.title}</a></li>)}
      </ul>
    </details>
  </div>;
}

/** Changing workspace is a full navigation: no run, selection or query cache is carried over. */
export function DatasetCatalogue({ projectId }: { projectId: string }) {
  const catalogue = useQuery(datasetCatalogueQuery(projectId));
  const importDataset = useImportCatalogueDataset(projectId);
  const track = useTrackJob(projectId);
  const [filter, setFilter] = useState("");
  const entries = catalogue.data?.imports.filter((entry) => `${entry.name} ${entry.context?.title ?? ""} ${entry.context?.processDescription ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())) ?? [];
  const localBrowser = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  return (
    <Card role="region" aria-labelledby="dataset-catalogue-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle id="dataset-catalogue-heading">Choose where to work</CardTitle>
        <Button size="sm" variant="ghost" disabled={catalogue.isFetching} onClick={() => void catalogue.refetch()}>Refresh catalogue</Button>
      </div>
      <p className="reading mb-3 text-sm text-text-muted">Open a registered dataset, or choose a local log below to import it into this project. The listed files are already on the server; no file selection or upload is needed.</p>
      {catalogue.isPending && <LoadingBlock rows={2} />}
      {catalogue.isError && <ErrorBlock error={catalogue.error} retry={() => void catalogue.refetch()} />}
      {catalogue.data && <>
        {catalogue.data.warning && <p role="status" className="mb-3 text-sm text-warning">{catalogue.data.warning}</p>}
        <h3 className="mb-2 text-sm font-semibold">Projects in this workspace</h3>
        <ul className="grid gap-2 md:grid-cols-2">
          {catalogue.data.projects.map((p) => (
            <li key={p.id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{p.name} {p.id === projectId && <span className="text-xs font-normal text-text-muted">· current project</span>}</p>
              <p className="mt-1 text-xs text-text-muted">{p.datasets.length} registered {p.datasets.length === 1 ? "dataset" : "datasets"}</p>
              <ul className="my-2 space-y-1 text-xs text-text-muted">
                {p.datasets.map((d) => <li key={d.id}>
                  <Link className="text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId: p.id, datasetId: d.id }} search={{ tab: "mapping" }}>{d.name} · {d.status === "ready" ? "imported" : d.status}{d.events != null && ` · ${fmtInt(d.events)} events`}</Link>
                  <PublishedContext context={d.context} />
                </li>)}
              </ul>
              {p.id !== projectId && <Button asChild size="sm" variant="outline"><Link to="/p/$projectId/data" params={{ projectId: p.id }} search={{}}>Open project</Link></Button>}
              {p.datasets.length === 0 && <p className="text-xs text-text-muted">No datasets imported yet.</p>}
            </li>
          ))}
        </ul>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Other local workspaces</h3>
        <p className="mb-2 text-xs text-text-muted">These are configured links to separate Workbench servers. Opening one does not copy or import its data. Availability is checked when you open it.</p>
        {catalogue.data.workspaces.length === 0 && <p className="text-sm text-text-muted">No other workspaces are linked. A local file is not a registered dataset until it has been imported.</p>}
        {!localBrowser && catalogue.data.workspaces.length > 0 && <p className="text-sm text-text-muted">Local workspace links are available when Workbench is opened on the same computer as those servers.</p>}
        {localBrowser && <ul className="grid gap-2 md:grid-cols-2">
          {catalogue.data.workspaces.map((w) => (
            <li key={`${w.origin}/${w.projectId}`} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{w.name} <span className="text-xs font-normal text-text-muted">· separate workspace</span></p>
              <p className="my-1 text-xs text-text-muted">{w.description}</p>
              <p className="mb-2 text-xs text-text-subtle">{w.origin}</p>
              <Button asChild size="sm" variant="outline"><a href={`${w.origin}/p/${encodeURIComponent(w.projectId)}/data`}>Open {w.name}</a></Button>
            </li>
          ))}
        </ul>}
        {catalogue.data.imports.length > 0 && <section className="mt-4 border-t border-border pt-3" aria-labelledby="local-dataset-heading">
          <h3 id="local-dataset-heading" className="text-sm font-semibold">Local dataset catalogue ({catalogue.data.imports.length})</h3>
          <p className="my-2 text-xs text-text-muted">Choose a log to prepare it here, then review its column mapping and readiness. Published challenge questions describe the original research task; they are not findings or a Process norm for your project.</p>
          <label className="mb-3 block text-sm">Find a local dataset
            <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 block w-full rounded-md border border-border bg-surface p-2" placeholder="Name or process, e.g. BPIC15 or travel" />
          </label>
          {entries.length === 0 && <p role="status" className="text-sm text-text-muted">No local datasets match your search.</p>}
          <ul className="grid gap-2 md:grid-cols-2">
            {entries.map((entry) => <li key={entry.id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{entry.name}</p>
              {entry.context ? <PublishedContext context={entry.context} /> : <p className="my-1 text-xs text-text-muted">{entry.description}</p>}
              <p className="mb-2 text-xs text-text-muted">{entry.dataset?.status === "ready" ? "Imported in this project · ready to open" : entry.dataset?.status === "ingesting" ? "Import in progress · follow the job tray" : entry.available ? "Available to import · mapping and review required" : entry.reason}</p>
              {entry.dataset?.status === "failed" && <p role="alert" className="mb-2 text-xs text-danger">Previous import failed: {entry.dataset.error ?? "Check the ingestion job for details."}</p>}
              <details className="mb-2 text-xs text-text-subtle"><summary className="cursor-pointer">Source location and preparation</summary><p className="break-all">{entry.path}</p><p>{entry.description}</p></details>
              {entry.dataset?.status === "ready"
                ? <Button asChild size="sm" variant="outline"><Link to="/p/$projectId/data/$datasetId" params={{ projectId, datasetId: entry.dataset.id }} search={{ tab: "mapping" }}>Open {entry.name}</Link></Button>
                : <Button size="sm" variant="outline" disabled={!entry.available || importDataset.isPending || entry.dataset?.status === "ingesting"} onClick={() => importDataset.mutate(entry.id, { onSuccess: (job) => track(job, `Import ${entry.name}`) })}>{entry.dataset?.status === "ingesting" ? `Importing ${entry.name}` : entry.dataset?.status === "failed" ? `Retry ${entry.name}` : `Import ${entry.name}`}</Button>}
            </li>)}
          </ul>
          {importDataset.isError && <ErrorBlock error={importDataset.error} className="mt-2" />}
          {importDataset.isSuccess && <p role="status" className="mt-2 text-xs text-text-muted">Import started. Open the dataset from the job tray when it finishes, then review the mapping.</p>}
        </section>}
      </>}
    </Card>
  );
}
