import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { notServed } from "@/lib/api/compatibility";
import { useCreateNormVersion } from "@/lib/api/norms";
import { normTemplatesQuery } from "@/lib/api/normTemplates";
import { normRefusal } from "./normErrors";

export interface GuidedProcessTemplateProps {
  projectId: string;
  caseTableId?: string;
  datasetName?: string;
  /** Reports the independent draft; the caller decides whether to open it. */
  onCreated: (normVersionId: string) => void;
}

const selectClass = "h-control w-full rounded border border-border bg-surface px-2 text-sm";

/** Catalogue is cheap; only an explicit preview reads one template against current data. */
export function GuidedProcessTemplate(props: GuidedProcessTemplateProps) {
  return <ProcessTemplateContext key={JSON.stringify([props.projectId, props.caseTableId])} {...props} />;
}

function ProcessTemplateContext({ projectId, caseTableId, datasetName, onCreated }: GuidedProcessTemplateProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [labelPack, setLabelPack] = useState("");
  const [requested, setRequested] = useState(false);
  const [name, setName] = useState("");
  const catalogue = useQuery({ ...normTemplatesQuery(projectId, caseTableId ?? ""), enabled: open && !!caseTableId });
  const preview = useQuery({
    ...normTemplatesQuery(projectId, caseTableId ?? "", labelPack, selectedId),
    enabled: requested && !!caseTableId && !!selectedId,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const create = useCreateNormVersion(projectId);
  const templates = catalogue.data?.templates ?? [];
  const selected = templates.find(template => template.id === selectedId);
  const prepared = requested && preview.isSuccess && !preview.isFetching && !catalogue.isError
    && preview.data.datasetId === catalogue.data?.datasetId && preview.data.process === catalogue.data?.process
    ? preview.data.templates.find(template => template.id === selectedId) : undefined;
  const canCreate = !!prepared?.available && !!prepared.norm && !!prepared.documentHash && !!name.trim() && !create.isPending;
  const invalidatePreview = () => { setRequested(false); create.reset(); };
  const save = () => {
    if (!canCreate || !prepared?.norm) return;
    create.mutate({
      norm: { ...prepared.norm, name: name.trim() },
      note: `Independent draft from ${prepared.name}; prepared for case table ${caseTableId}. Numeric thresholds require review.`,
    }, { onSuccess: version => onCreated(version.id) });
  };
  const requestPreview = () => {
    if (requested) void preview.refetch();
    else setRequested(true);
  };

  return <details className="rounded border border-border bg-surface px-3 py-2" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) setRequested(false);
  }}>
    <summary className="cursor-pointer text-sm font-medium">Prepare a process template</summary>
    <div className="mt-3 space-y-3">
      {!caseTableId ? <p className="text-sm">Select a prepared case table for this project to preview its process templates.</p> : catalogue.isPending ? <p role="status" className="text-sm">Loading process templates…</p> : catalogue.isError ? <p role="alert" className="text-sm">
        {notServed(catalogue.error) ? "Process templates are not available from this backend for the selected preparation." : "The template catalogue could not be verified. Check the selected project data and retry."}
        {" "}<Button size="sm" variant="ghost" onClick={() => void catalogue.refetch()}>Retry templates</Button>
      </p> : !templates.length ? <p className="text-sm">{catalogue.data?.process ? `No norm templates are configured for ${catalogue.data.process}.` : "This project has no process type, so no process template can be matched."}</p> : <>
        <p className="text-xs text-text-muted">Prepare a separate draft for {datasetName ?? "the selected project data"}. Review its purpose, labels and scope before using it.</p>
        <Field label="Process template" htmlFor={`${id}-template`}>
          <select id={`${id}-template`} className={selectClass} value={selectedId} disabled={create.isPending} onChange={event => {
            const template = templates.find(item => item.id === event.target.value);
            setSelectedId(event.target.value); setName(template ? `${template.name} draft` : ""); setLabelPack(""); invalidatePreview();
          }}>
            <option value="">Choose a process template</option>
            {templates.map(template => <option key={template.id} value={template.id}>{template.name}{template.available ? "" : " — unavailable"}</option>)}
          </select>
        </Field>
        {selected && (!selected.available ? <p role="status" className="text-sm">{selected.reason ?? "This template document is unavailable."}</p> : <>
          <p className="text-xs text-text-muted">{selected.description}</p>
          {selected.activityLabels === "canonical_ids" && !!catalogue.data?.labelPacks.length && <Field label="Activity labels" htmlFor={`${id}-labels`}>
            <select id={`${id}-labels`} className={selectClass} value={labelPack} disabled={create.isPending} onChange={event => { setLabelPack(event.target.value); invalidatePreview(); }}>
              <option value="">Keep template labels; review after import</option>
              {catalogue.data.labelPacks.map(pack => <option key={pack.id} value={pack.id}>{pack.id} — {pack.observedLabels}/{pack.totalLabels} labels recorded</option>)}
            </select>
            <p className="mt-1 text-xs text-text-muted">Choose a curated mapping only if its event meanings fit this data. Label coverage is not rule applicability.</p>
          </Field>}
          <Field label="Draft norm name" htmlFor={`${id}-name`}><Input id={`${id}-name`} value={name} disabled={create.isPending} onChange={event => setName(event.target.value)} /></Field>
          <Button size="sm" variant="outline" onClick={requestPreview} disabled={create.isPending || requested && preview.isFetching}>{requested && preview.isFetching ? "Previewing…" : "Preview selected template"}</Button>
          {requested && preview.isFetching && <p role="status" className="text-xs">Checking this template against the selected data. Large logs can take a moment.</p>}
          {requested && preview.isError && <p role="alert" className="text-sm">The selected template preview could not be verified. Retry the preview before creating a draft.</p>}
          {prepared && (!prepared.available || !prepared.norm ? <p role="alert" className="text-sm">{prepared.reason ?? "This template could not be prepared."}</p> : <>
            <details className="text-xs">
              <summary className="cursor-pointer">Preview {(prepared.constraints ?? []).length} rules and source caveats</summary>
              <div className="mt-2 space-y-2">
                <p className="text-text-muted">{(prepared.pendingConstraintIds ?? []).length} numeric decisions will need review. Rules with missing labels, unknown scope or no applicable cases remain in the draft and appear later in this preview. This does not mark them outside business scope.</p>
                {(prepared.warnings ?? []).map((warning, index) => <p key={index} className="text-text-muted">{warning}</p>)}
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {(prepared.constraints ?? []).map(rule => <li key={rule.id} className="rounded border border-border p-2">
                    <p className="font-medium">{rule.description}</p>
                    <p className="text-text-muted">{rule.layer} · {rule.type} · {rule.casesInScope === null ? "Scope unknown" : `${rule.casesInScope}/${preview.data?.cases} cases in scope`}{rule.priority === "low" ? " · Review later" : ""}</p>
                    {!!rule.missingActivities.length && <p>Unobserved labels: {rule.missingActivities.join(", ")}</p>}
                    {rule.issues.map((issue, index) => <p key={index}>{issue}</p>)}
                  </li>)}
                </ul>
              </div>
            </details>
            <p className="text-xs text-text-muted">Creates an independent draft with imported numeric thresholds pending. Your dataset and existing norm are kept; no assessment or approval is started.</p>
            <Button size="sm" onClick={save} disabled={!canCreate}>{create.isPending ? "Creating…" : "Create independent draft"}</Button>
          </>)}
          {create.isError && <p role="alert" className="text-sm text-danger">Your preview and name are kept. {normRefusal(create.error, {}, "save")}</p>}
        </>)}
      </>}
    </div>
  </details>;
}

export default GuidedProcessTemplate;
