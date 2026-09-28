import { Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "@/app/context";
import { useTrackJob } from "@/app/shell/JobTray";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { fmtBytes, fmtDateTime, fmtInt } from "@/lib/format";
import { datasetsQuery, presetsQuery, useLoadPreset, useUploadDataset } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { DatasetCatalogue } from "./DatasetCatalogue";

const ACCEPT = ".csv,.parquet,.xes,.xes.gz,.gz";

/** Dropzone: file input plus drag events; the upload returns an ingest job that the tray follows. */
export function Dropzone({ projectId, onStarted }: { projectId: string; onStarted?: (datasetId?: string) => void }) {
  const upload = useUploadDataset(projectId);
  const track = useTrackJob(projectId);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File>();

  const start = (f: File) => {
    setFile(f);
    upload.mutate(
      { file: f, name: f.name },
      {
        onSuccess: (job) => {
          track(job, `Ingest ${f.name}`);
          onStarted?.();
        },
      },
    );
  };

  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors duration-fast", over ? "border-accent bg-accent-subtle" : "border-border-strong bg-surface")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) start(f);
      }}
    >
      <Upload className="size-6 text-text-subtle" aria-hidden />
      <p className="text-sm">Drop a CSV, Parquet or XES file here</p>
      <p className="text-xs text-text-muted">The file is uploaded to this Workbench server. Review its column mapping and data readiness before assessing it.</p>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" id="dataset-file" aria-label="Choose an event log file" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
      <Button variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
        Choose file…
      </Button>
      {file && (
        <p className="text-xs text-text-muted" aria-live="polite">
          {upload.isPending ? "Uploading" : upload.isSuccess ? "Ingest job started for" : upload.isError ? "Upload failed for" : ""} {file.name} ({fmtBytes(file.size)})
        </p>
      )}
      {upload.isError && <ErrorBlock error={upload.error} />}
    </div>
  );
}

/** Public logs with a known mapping and norm: one click to a scored run. */
export function PresetCard({ projectId }: { projectId: string }) {
  const presets = useQuery(presetsQuery(projectId));
  const load = useLoadPreset(projectId);
  const track = useTrackJob(projectId);
  return (
    <Card aria-labelledby="preset-heading">
      <CardTitle id="preset-heading">Load a known log</CardTitle>
      <p className="mb-2 text-xs text-text-muted">Configured logs on the Workbench server can be loaded with a supplied mapping and reference norm. This starts a preparation and assessment job in the current project. Review the mapping, data caveats and norm before using its results.</p>
      {presets.isPending && <LoadingBlock rows={2} />}
      {presets.isError && <ErrorBlock error={presets.error} />}
      <ul className="flex flex-col gap-2">
        {(presets.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {p.name}
                {p.localOnly ? (
                  <span className="rounded-full border border-warning px-2 py-0.5 text-[11px] font-normal text-warning">private source</span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-text-muted">public dataset</span>
                )}
              </p>
              <p className="text-xs text-text-muted">{p.description}</p>
              <details className="mt-1 text-xs text-text-muted">
                <summary className="cursor-pointer">Source and setup details</summary>
                <p className="mt-1 break-all">Log: {p.source}</p>
                <p className="break-all">Reference norm: {p.norm}</p>
                <p>{p.id === "bpic2019" ? "Configure WISE_BPIC19_CSV and WISE_BPIC19_NORM on the server." : "Configure the preset’s source directory through WISE_PRESET_DATA_DIRS on the server."}</p>
              </details>
              {!p.available && <p className="mt-1 text-xs text-warning">This preset is unavailable: its log or reference norm is missing from the configured location.</p>}
            </div>
            <Button
              disabled={!p.available || load.isPending}
              onClick={() =>
                load.mutate(p.id, {
                  onSuccess: (job) => track(job, `Load ${p.name}`, { kind: "run", id: "" }),
                })
              }
            >
              {p.localOnly ? "Load this private log" : "Load public dataset"}
            </Button>
          </li>
        ))}
      </ul>
      {presets.data?.length === 0 && <p className="text-sm text-text-muted">No prepared log presets are configured. Choose a file to import below, or open an existing project above.</p>}
      {load.isError && <ErrorBlock error={load.error} className="mt-2" />}
      {load.isSuccess && <p className="mt-2 text-xs text-text-muted">Job {load.data.id} started; the run opens from the job tray when it is done.</p>}
    </Card>
  );
}

/** Dataset selection and intake; observed analysis belongs to the selected dataset. */
export default function DataPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const datasets = useQuery(datasetsQuery(ctx.projectId));
  const caseTable = ctx.caseTable;

  if (ctx.datasetBindingState === "bound" && ctx.datasetBinding?.datasetId) return <Navigate
    to="/p/$projectId/data/$datasetId"
    params={{ projectId: ctx.projectId, datasetId: ctx.datasetBinding.datasetId }}
    search={{ tab: "overview", caseTable: caseTable?.datasetId === ctx.datasetBinding.datasetId ? caseTable.id : undefined }}
    replace
  />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-text-subtle">Data · log intake and data caveats</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Data and mapping
          <HowToReadToggle id="data" />
        </h1>
        <p className="reading text-base text-text-muted">Open an existing dataset or another workspace, or import a log into this project. Then review its column mapping and data caveats before analysis.</p>
        <HowToRead id="data">
          The journey starts with an event log. Drop a file or load a public log; the mapping form opens prefilled and builds the case table; the data caveats say what could distort the results. Open the dataset to explore its recorded cases and compare flow types before defining a Process norm.
        </HowToRead>
      </header>
      <DatasetCatalogue projectId={ctx.projectId} />
      {caseTable && <Card>
        <CardTitle>Continue with the prepared dataset</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {([{ tab: "understand", label: "Process guide" }, { tab: "overview", label: "Explore data" }, { tab: "flows", label: "Compare flow types" }] as const).map(({ tab, label }) => <Button key={tab} variant="outline" asChild><Link to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: caseTable.datasetId }} search={{ caseTable: caseTable.id, tab }}>{label}</Link></Button>)}
        </div>
      </Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Dropzone projectId={ctx.projectId} />
        <PresetCard projectId={ctx.projectId} />
      </div>
      {datasets.isPending && <LoadingBlock />}
      {datasets.isError && <ErrorBlock error={datasets.error} retry={() => void datasets.refetch()} />}
      {datasets.data && datasets.data.length === 0 && <EmptyState title={t("empty.noDatasets")} reason={t("empty.noDatasetsReason")} />}
      {datasets.data && datasets.data.length > 0 && (
        <Card>
          <CardTitle>Datasets</CardTitle>
          <p className="mb-2 text-xs text-text-muted">Registered in this project. Open a dataset to review its mapping and readiness.</p>
          <Table>
            <thead>
              <tr>
                <Th>name</Th>
                <Th>status</Th>
                <Th numeric>events</Th>
                <Th>created</Th>
                <Th>
                  <span className="sr-only">{t("app.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {datasets.data.map((d) => (
                <tr key={d.id}>
                  <Td>
                    {/* R3-13: the file's own name is the label; its id and its content hash are how the run is
                        reproduced, not what the dataset is called, and they live under "details" on the run */}
                    <Link className="font-medium text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: d.id }} search={{ tab: "mapping" }} title={d.contentHash ? `content hash ${d.contentHash}` : undefined}>
                      {d.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge variant={d.status === "ready" ? "success" : d.status === "failed" ? "danger" : "info"}>
                      <span aria-hidden>{d.status === "ready" ? "●" : d.status === "failed" ? "✕" : "◐"}</span>
                      {d.status}
                    </Badge>
                  </Td>
                  <Td numeric>{fmtInt(d.events)}</Td>
                  <Td>{fmtDateTime(d.createdAt)}</Td>
                  <Td>
                    {d.status === "ready" && (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: d.id }} search={{ tab: "mapping" }}>
                          Map columns
                        </Link>
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
