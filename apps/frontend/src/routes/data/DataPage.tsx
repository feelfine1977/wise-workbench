import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkbench } from "@/app/context";
import { useTrackJob } from "@/app/shell/JobTray";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { YourProcess } from "../flow/YourProcess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { fmtBytes, fmtDateTime, fmtInt } from "@/lib/format";
import { datasetsQuery, presetsQuery, useLoadPreset, useUploadDataset } from "@/lib/queries";
import { cn } from "@/lib/utils";

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
      <p className="text-xs text-text-muted">The ingest job writes events.parquet and a content hash; a readiness report follows the mapping.</p>
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
      <CardTitle id="preset-heading">Load public log preset</CardTitle>
      <p className="mb-2 text-xs text-text-muted">A known log on this machine, its column mapping and the reference norm, ingested, built and scored in one job. The file is read in place, not copied.</p>
      {presets.isPending && <LoadingBlock rows={2} />}
      {presets.isError && <ErrorBlock error={presets.error} />}
      <ul className="flex flex-col gap-2">
        {(presets.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-text-muted">{p.description}</p>
              <p className="mt-1 font-mono text-[11px] text-text-subtle">{p.source}</p>
              {!p.available && <p className="mt-1 text-xs text-warning">The file is not at this path on this machine; set WISE_BPIC19_CSV (and WISE_BPIC19_NORM) for the backend.</p>}
            </div>
            <Button
              disabled={!p.available || load.isPending}
              onClick={() =>
                load.mutate(p.id, {
                  onSuccess: (job) => track(job, `Load ${p.name}`, { kind: "run", id: "" }),
                })
              }
            >
              Load public log preset
            </Button>
          </li>
        ))}
      </ul>
      {load.isError && <ErrorBlock error={load.error} className="mt-2" />}
      {load.isSuccess && <p className="mt-2 text-xs text-text-muted">Job {load.data.id} started; the run opens from the job tray when it is done.</p>}
    </Card>
  );
}

/** Data — datasets, upload, public log presets and, once a case table exists, "Your process" by flow type. */
export default function DataPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const datasets = useQuery(datasetsQuery(ctx.projectId));
  const caseTable = ctx.caseTable;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-text-subtle">Data · log intake and data caveats</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Data and mapping
          <HowToReadToggle id="data" />
        </h1>
        <p className="reading text-base text-text-muted">Upload a log, map its columns, decide about the data caveats and choose how to analyse the flow types — or load a public log in one click.</p>
        <HowToRead id="data">
          The journey starts with an event log. Drop a file or load a public log; the mapping form opens prefilled and builds the case table; the data caveats say what could distort the results. When a case table exists, <strong>Your process</strong> below shows the
          flow types and asks whether to compare everything together or to analyse each flow type on its own.
        </HowToRead>
      </header>
      {caseTable ? (
        <NextStep label="Open the data caveats and decide" because={`${(caseTable.readiness?.items ?? []).filter((i) => i.level === "warn").length} caveats travel with every result until you decide about them`} to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: caseTable.datasetId }} search={{ caseTable: caseTable.id, tab: "readiness" }} />
      ) : (
        <NextStep label="Load the public log preset" because="one job ingests, builds the case table, imports the norm and scores; the data caveats appear on the way" onClick={() => document.getElementById("preset-heading")?.scrollIntoView({ block: "center" })} />
      )}
      {caseTable && <YourProcess projectId={ctx.projectId} caseTableId={caseTable.id} runs={ctx.runs} mode="data" />}
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
          <Table>
            <thead>
              <tr>
                <Th>name</Th>
                <Th>status</Th>
                <Th numeric>events</Th>
                <Th>content hash</Th>
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
                    <Link className="font-medium text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId: ctx.projectId, datasetId: d.id }} search={{ tab: "mapping" }}>
                      {d.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-text-subtle">{d.id}</span>
                  </Td>
                  <Td>
                    <Badge variant={d.status === "ready" ? "success" : d.status === "failed" ? "danger" : "info"}>
                      <span aria-hidden>{d.status === "ready" ? "●" : d.status === "failed" ? "✕" : "◐"}</span>
                      {d.status}
                    </Badge>
                  </Td>
                  <Td numeric>{fmtInt(d.events)}</Td>
                  <Td className="font-mono text-xs">{d.contentHash ?? "–"}</Td>
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
