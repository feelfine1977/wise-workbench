import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/misc";
import { inventoryQuery, normCalibrationQuery, normQuery, useCreateNormVersion } from "@/lib/api/norms";
import { fmtInt } from "@/lib/format";
import { PROCESS_PRIMER_PROFILES, resolveProcessPrimer, type ProcessPrimerId } from "@/routes/data/processPrimerProfiles";
import { constraintName, type NormDocument } from "./normAuthoring";
import { normRefusal } from "./normErrors";
import { readAuthoringBrief, readLayerGuidance, withAuthoringBrief, type AuthoringBrief } from "./normGuideState";

export interface NormGuideProps {
  projectId: string;
  versionId: string;
  document: NormDocument;
  process?: string;
  datasetName?: string;
  caseTableId?: string;
  caseNoun?: string;
  /** Count for this norm and displayed case-table scope; omitted/null means unknown. */
  coverageWarnings?: number | null;
  onTab: (tab: "constraints" | "structure" | "review" | "map") => void;
  onConstraint: (id: string) => void;
  onSaved: (id: string) => void;
}

const selectClass = "h-control w-full rounded border border-border bg-surface px-2 text-sm";
const summaryClass = "cursor-pointer py-1 text-sm font-medium text-accent-text";
const linkClass = "text-sm text-accent-text underline underline-offset-2";
const situations = {
  new: "Explore the log first: identify what one case represents, who hands work to whom, and what the recorded events mean. Then describe what should happen.",
  known: "Start with the expectation you want to define. Use the full editors directly, and check that the selected data can measure the rule.",
  reassess: "Start with the previous decision and what has changed: the business goal, data coverage or agreed target. Existing assessments keep their original norm.",
};
const collaborationHelp = {
  single: "Record your assumptions and the person who can confirm the business expectation.",
  workshop: "Agree the scope and evidence together. Record proposals, objections and the accountable owner before confirming individual decisions in Review.",
  async: "Give contributors this version and the evidence references. Record unresolved questions; a named participant or an unanswered request does not count as approval.",
};

/** The parent may force-mount tabs. A different project/version always gets its own local brief. */
export function NormGuide(props: NormGuideProps) {
  return <GuideContent key={`${props.projectId}:${props.versionId}`} {...props} />;
}

function GuideContent({ projectId, versionId, document, process, datasetName, caseTableId, caseNoun, coverageWarnings, onTab, onConstraint, onSaved }: NormGuideProps) {
  const id = useId();
  const [brief, setBrief] = useState(() => readAuthoringBrief(document));
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
  const [layerId, setLayerId] = useState(document.layers?.[0]?.id ?? "");
  const profile = resolveProcessPrimer(process);
  const [exampleId, setExampleId] = useState<ProcessPrimerId | "">(profile?.id ?? "");
  const example = exampleId ? PROCESS_PRIMER_PROFILES[exampleId] : undefined;
  const constraints = document.constraints ?? [];
  const layers = document.layers ?? [];
  const layer = layers.find(item => item.id === layerId) ?? layers[0];
  const guidance = readLayerGuidance(document, layer?.id ?? "");
  const dirty = JSON.stringify(brief) !== JSON.stringify(readAuthoringBrief(document));
  const create = useCreateNormVersion(projectId);
  const calibration = useQuery(normCalibrationQuery(projectId, versionId));
  const inventory = useQuery({ ...inventoryQuery(projectId, caseTableId ?? ""), enabled: inventoryOpen && !!caseTableId });
  // Only reassessment needs lineage. These keys cannot borrow another version's parent.
  const current = useQuery({ ...normQuery(projectId, versionId), enabled: brief.situation === "reassess", retry: false });
  const parentId = current.data?.id === versionId ? current.data.parentId : undefined;
  const parent = useQuery({ ...normQuery(projectId, parentId ?? ""), enabled: brief.situation === "reassess" && !!parentId, retry: false });
  const checkingReview = calibration.isPending || calibration.isFetching;
  const review = !checkingReview && !calibration.isError && calibration.data?.normVersionId === versionId ? calibration.data : undefined;
  const missing = Array.isArray(review?.missingRationale) ? review.missingRationale : undefined;
  const coverageCount = typeof coverageWarnings === "number" && Number.isInteger(coverageWarnings) && coverageWarnings >= 0 ? coverageWarnings : undefined;
  const dataUrl = `/p/${encodeURIComponent(projectId)}/data${caseTableId ? `?caseTable=${encodeURIComponent(caseTableId)}` : ""}`;
  const change = (patch: Partial<AuthoringBrief>) => { setBrief(previous => ({ ...previous, ...patch })); create.reset(); };
  const save = () => {
    if (!dirty || create.isPending || create.isSuccess) return;
    create.mutate({
      norm: withAuthoringBrief(document, brief),
      parentId: versionId,
      note: brief.goal.trim() ? `Working brief updated — ${brief.goal.trim()}` : "Working brief updated",
    }, { onSuccess: saved => onSaved(saved.id) });
  };

  return <section aria-label="Norm authoring guide" className="space-y-4">
    <Card className="border-t-2 border-t-accent">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
        <div>
          <CardTitle as="h2">Purpose and context</CardTitle>
          <p className="max-w-prose text-sm">Define what should happen in the process and why it matters. Begin where useful; every editor remains available.</p>
          <p className="mt-2 max-w-prose text-sm text-text-muted">{situations[brief.situation]}</p>
          {brief.situation === "new" && <a href={dataUrl} className={`${linkClass} mt-2 inline-block`}>Explore process data first</a>}
        </div>
        <Field label="Your starting point" htmlFor={`${id}-situation`}>
          <select id={`${id}-situation`} className={selectClass} value={brief.situation} disabled={create.isPending || create.isSuccess} onChange={event => change({ situation: event.target.value as AuthoringBrief["situation"] })}>
            <option value="new">New to this process</option>
            <option value="known">I know this process</option>
            <option value="reassess">Reassess an existing norm</option>
          </select>
        </Field>
      </div>
      <dl className="mt-4 grid gap-3 rounded border border-border bg-surface-sunken p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-text-muted">Process</dt><dd className="mt-1 break-words font-medium">{profile?.name ?? process ?? "Not specified"}</dd></div>
        <div><dt className="text-text-muted">Dataset</dt><dd className="mt-1 break-words font-medium">{datasetName ?? "Not supplied"}</dd></div>
        <div><dt className="text-text-muted">One case represents</dt><dd className="mt-1 break-words font-medium">{caseTableId ? caseNoun ?? "Confirm the case unit" : "No mapped table selected"}</dd></div>
        <div><dt className="text-text-muted">Norm version</dt><dd className="mt-1 break-words font-medium">{document.name ?? "Process norm"}</dd></div>
      </dl>
      <details className="mt-2"><summary className={summaryClass}>Preparation and version identifiers</summary><p className="mt-1 break-all text-xs text-text-muted">Prepared table: {caseTableId ?? "None"} · Norm version: {versionId}</p></details>

      {brief.situation === "reassess" && <div className="mt-3 rounded border border-border p-3 text-sm" aria-label="Reassessment context">
        {current.isPending && <p role="status">Loading this version’s parent context…</p>}
        {current.isError && <p role="alert">Parent context could not be read. <Button variant="ghost" size="sm" onClick={() => void current.refetch()}>Retry version context</Button></p>}
        {current.isSuccess && !parentId && <p>This version has no recorded parent. State the earlier policy or evidence you are reassessing in the working brief.</p>}
        {parentId && <>
          <p>Parent version: <span className="break-all">{parentId}</span></p>
          {parent.isPending && <p role="status">Loading the previous decision…</p>}
          {parent.isError && <p role="alert">The parent version could not be read. <Button variant="ghost" size="sm" onClick={() => void parent.refetch()}>Retry parent version</Button></p>}
          {parent.data && <details className="mt-2"><summary className={summaryClass}>Previous version {parent.data.version} · {parent.data.status}</summary><p className="mt-2 whitespace-pre-wrap break-words">{parent.data.note || "No version note recorded."}</p></details>}
          <p className="mt-2 text-xs text-text-muted">Compare the prior reason and population. A changed target can change a score without a change in the process.</p>
        </>}
      </div>}

      <details className="mt-3 border-t border-border pt-2">
        <summary className={summaryClass}>Process examples and sources</summary>
        <div className="mt-2 max-w-prose space-y-2 text-sm">
          <Field label="Illustrative process example" htmlFor={`${id}-example`}>
            <select id={`${id}-example`} className={selectClass} value={exampleId} onChange={event => setExampleId(event.target.value as ProcessPrimerId | "")}>
              <option value="">Choose an example</option><option value="p2p">Procure-to-pay (P2P)</option><option value="o2c">Order-to-cash (O2C)</option>
            </select>
          </Field>
          <p className="text-xs text-text-muted">Illustrative guidance, not findings from this dataset. Choosing an example leaves your process, data and norm unchanged.</p>
          {example && <>
            <p>{example.purpose}</p><p className="text-text-muted">{example.boundary}</p>
            <p className="text-xs">Typical handoff: {example.handoffs[1]?.from} → {example.handoffs[1]?.to}: {example.handoffs[1]?.pass}.</p>
            {example.sources[0] && <a className={linkClass} href={example.sources[0].url} target="_blank" rel="noreferrer">{example.sources[0].title}</a>}
          </>}
        </div>
      </details>
    </Card>

    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle as="h2" className="flex items-center gap-2"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-sm text-accent-text">1</span>Expectations</CardTitle>
        <p className="text-sm text-text-muted">Describe what should happen, to which cases, and who can explain the business reason. {constraints.length ? `${fmtInt(constraints.length)} constraints are already defined.` : "No constraints are defined yet."}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => onTab("constraints")}>Open constraints</Button>
        {layers.length > 0 && <details className="mt-3 border-t border-border pt-2" onToggle={event => setLayerOpen(event.currentTarget.open)}>
          <summary className={summaryClass}>Explore the purpose of {layers.length} {layers.length === 1 ? "layer" : "layers"}</summary>
          {layerOpen && <div className="mt-2 space-y-3 text-sm">
            <Field label="Layer to understand" htmlFor={`${id}-layer`}><select id={`${id}-layer`} className={selectClass} value={layer?.id ?? ""} onChange={event => setLayerId(event.target.value)}>{layers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <p className="text-xs text-text-muted">Saved norm guidance describes its source context; it is not a measurement of the selected data.</p>
            <dl className="space-y-2 break-words">
              {guidance.expectation && <div><dt className="font-medium">Expectation</dt><dd>{guidance.expectation}</dd></div>}
              {guidance.why && <div><dt className="font-medium">Why it matters</dt><dd>{guidance.why}</dd></div>}
              {!guidance.expectation && !guidance.why && <div><dt className="font-medium">Purpose</dt><dd>{layer?.description || "No purpose recorded for this layer. Agree it with the people doing the work."}</dd></div>}
              {guidance.owner && <div><dt className="font-medium">Suggested owner role</dt><dd>{guidance.owner.replace(/_/g, " ")}</dd></div>}
            </dl>
            {guidance.checks.length > 0 && <div><p className="font-medium">What to check first</p><ul className="list-disc space-y-1 pl-5">{guidance.checks.slice(0, 3).map((check, index) => <li key={index}>{check}</li>)}</ul>{guidance.checks.length > 3 && <p className="mt-1 text-xs text-text-muted">Showing the first three saved checks.</p>}</div>}
            {guidance.stakeholders && <details><summary className={summaryClass}>Stakeholder context</summary><p className="mt-2 break-words">{guidance.stakeholders}</p></details>}
          </div>}
        </details>}
      </Card>

      <Card>
        <CardTitle as="h2" className="flex items-center gap-2"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-sm text-accent-text">2</span>Data you can observe</CardTitle>
        <p className="text-sm text-text-muted">Check event meanings, timestamps and links between records. An absent event may reflect missing coverage or a different process path; absence alone does not establish a violation.</p>
        <details className="mt-3" onToggle={event => setInventoryOpen(event.currentTarget.open)}>
          <summary className={summaryClass}>Inspect the selected data inventory</summary>
          {inventoryOpen && <div className="mt-2 space-y-2 text-sm" aria-label="Data inventory">
            {!caseTableId ? <p>Select a mapped case table in Data before checking observability.</p> : inventory.isPending ? <p role="status">Loading the selected case table’s inventory…</p> : inventory.isError ? <p role="alert">Inventory could not be read. <Button variant="ghost" size="sm" onClick={() => void inventory.refetch()}>Retry inventory</Button></p> : inventory.data && <>
              <p>{fmtInt(inventory.data.cases)} {inventory.data.caseNoun ?? caseNoun ?? "cases"} · {fmtInt(inventory.data.events)} events · {inventory.data.activities ? `${fmtInt(inventory.data.activities.length)} activity labels` : "Activity list unavailable"} · {inventory.data.attributes ? `${fmtInt(inventory.data.attributes.length)} attributes` : "Attribute list unavailable"}</p>
              <p>{inventory.data.cases === 0 ? "This case table has no recorded cases." : "This inventory covers the selected case table. Check applicability and measured coverage separately for each constraint."}</p>
              <p className="text-xs text-text-muted">{inventory.data.attributes ? `${inventory.data.attributes.filter(attribute => (attribute.missing ?? 0) > 0).length} attributes report missing values.` : "Attribute completeness was not supplied."} Inventory counts are not conformance results.</p>
            </>}
            <a href={dataUrl} className={linkClass}>Open process data</a>
          </div>}
        </details>
      </Card>

      <Card>
        <CardTitle as="h2" className="flex items-center gap-2"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-sm text-accent-text">3</span>Layers and views</CardTitle>
        <p className="text-sm text-text-muted">Group constraints by business purpose, then weight those layers for each view. Views change importance; the project, data and individual constraint truth stay the same.</p>
        <p className="mt-2 text-xs text-text-muted">{layers.length} layers · {document.views?.length ?? 0} views. Existing direct constraint weights remain in their original form.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onTab("structure")}>Edit layers and views</Button><Button size="sm" variant="ghost" onClick={() => onTab("map")}>Open norm map</Button></div>
      </Card>

      <Card>
        <CardTitle as="h2" className="flex items-center gap-2"><span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-accent-subtle text-sm text-accent-text">4</span>Review and revisit</CardTitle>
        <div role="group" aria-label="Coverage and applicability review" className="space-y-2">
          <h3 className="text-sm font-medium">Coverage and applicability</h3>
          <p className="text-sm text-text-muted">{coverageCount === undefined ? "Coverage/applicability warning count is unknown." : `${fmtInt(coverageCount)} ${coverageCount === 1 ? "constraint has" : "constraints have"} coverage or applicability warnings on this log.`}</p>
          <Button size="sm" variant="ghost" onClick={() => onTab("constraints")}>Inspect coverage and applicability</Button>
        </div>
        <div role="group" aria-label="Calibration decision review" className="mt-3 space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-medium">Calibration decisions</h3>
          {checkingReview ? <p role="status" className="text-sm text-text-muted">Checking saved calibration requirements…</p> : calibration.isError ? <p role="alert" className="text-sm">Review requirements could not be checked. <Button variant="ghost" size="sm" onClick={() => void calibration.refetch()}>Retry review requirements</Button></p> : <>
            <p className="text-sm text-text-muted">{missing === undefined ? "Missing calibration rationale count is unknown; it was not supplied for this version." : missing.length ? `${missing.length} constraints need a reason, an owner or confirmation of a changed decision.` : "0 constraints are reported as needing calibration rationale. Coverage warnings and sign-off are separate."}</p>
            {review?.canLeaveDraft === false && <p className="text-xs text-text-muted">Review requirements are unresolved. Open Review for details.</p>}
            {missing && missing.length > 0 && <details className="mt-2"><summary className={summaryClass}>Required decisions{missing.length > 5 ? ` · first 5 of ${missing.length}` : ""}</summary><ul className="mt-2 space-y-2" aria-label="Decision shortlist">{missing.slice(0, 5).map(constraintId => {
              const constraint = constraints.find(item => item.id === constraintId);
              const row = review?.thresholds?.find(item => item.constraint_id === constraintId);
              const needs = [!row?.rationale?.trim() && "reason", !row?.owner?.trim() && "owner"].filter(Boolean).join(" and ") || "confirmation";
              const name = constraint ? constraintName(constraint) : constraintId;
              return <li key={constraintId}><button type="button" className="w-full text-left text-sm text-accent-text underline" title={name} onClick={() => onConstraint(constraintId)}><span className="line-clamp-2 break-words">{name}</span></button><p className="text-xs text-text-muted">Needs {needs}</p></li>;
            })}</ul></details>}
          </>}
          <Button size="sm" variant="ghost" onClick={() => onTab("review")}>Review calibration decisions</Button>
        </div>
        <div role="group" aria-label="Version sign-off" className="mt-3 space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-medium">Version sign-off</h3>
          <p className="text-sm text-text-muted">{review?.status ? `Saved version status: ${review.status}.` : "Saved version review status is unknown."}{review?.status === "draft" ? " This draft has not been signed off." : ""}</p>
          {review?.status === "draft" && <p className="text-xs text-text-muted">{review.canLeaveDraft === true ? "Saved requirements report no calibration blocker to leaving draft. Sign-off still requires an explicit review action." : review.canLeaveDraft === false ? "Required decisions must be resolved before sign-off." : "Sign-off eligibility is unknown."}</p>}
          <Button size="sm" variant="outline" onClick={() => onTab("review")}>Open review</Button>
          <p className="text-xs text-text-muted">Review records explicit decisions. Saving a brief never signs a version.</p>
        </div>
      </Card>
    </div>

    <Card>
      <details>
        <summary className={summaryClass}>Working brief{dirty && !create.isSuccess ? " · unsaved changes" : ""}</summary>
        <p className="mt-2 text-sm text-text-muted">Capture the purpose, contributors and open questions. This brief is not approval and does not change rules or weights. Incomplete notes can be saved as a new draft.</p>
        <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); save(); }}>
          <fieldset disabled={create.isPending || create.isSuccess} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Working brief fields</legend>
            <Field label="Purpose / goal" htmlFor={`${id}-goal`} className="sm:col-span-2"><Textarea id={`${id}-goal`} rows={2} value={brief.goal} onChange={event => change({ goal: event.target.value })} placeholder="Which business expectation or decision are you working on?" /></Field>
            <Field label="How you will contribute" htmlFor={`${id}-collaboration`}><select id={`${id}-collaboration`} className={selectClass} value={brief.collaboration} onChange={event => change({ collaboration: event.target.value as AuthoringBrief["collaboration"] })}><option value="single">Individual work</option><option value="workshop">Workshop</option><option value="async">Asynchronous contributions</option></select></Field>
            <Field label="Brief owner" htmlFor={`${id}-owner`}><Input id={`${id}-owner`} value={brief.owner} onChange={event => change({ owner: event.target.value })} placeholder="Person or role coordinating this work" /></Field>
            <p className="text-xs text-text-muted sm:col-span-2">{collaborationHelp[brief.collaboration]}</p>
            <Field label="Participants / roles" htmlFor={`${id}-participants`}><Input id={`${id}-participants`} value={brief.participants} onChange={event => change({ participants: event.target.value })} /></Field>
            <Field label="Evidence / sources" htmlFor={`${id}-evidence`}><Textarea id={`${id}-evidence`} rows={2} value={brief.evidence} onChange={event => change({ evidence: event.target.value })} placeholder={profile?.id === "p2p" ? "Purchasing policy, receipt coverage, supplier payment terms" : profile?.id === "o2c" ? "Customer promise, delivery records, invoice and payment links" : "Policy, source document, data reference or agreed requirement"} /></Field>
            <Field label="Open questions" htmlFor={`${id}-questions`} className="sm:col-span-2"><Textarea id={`${id}-questions`} rows={2} value={brief.openQuestions} onChange={event => change({ openQuestions: event.target.value })} placeholder="What still needs evidence or an explicit decision?" /></Field>
          </fieldset>
          {create.isError && <p role="alert" className="text-sm text-danger">The brief could not be saved. Your entries are kept. {normRefusal(create.error, {}, "save")}</p>}
          {create.isSuccess && <p role="status" className="text-sm">Working brief saved as a new draft.</p>}
          <div className="flex flex-wrap items-center gap-3"><Button size="sm" type="submit" disabled={!dirty || create.isPending || create.isSuccess}>{create.isPending ? "Saving brief…" : "Save working brief as new draft"}</Button><p className="text-xs text-text-muted">Unsaved notes stay while switching norm tabs. Save before leaving this version.</p></div>
        </form>
      </details>
    </Card>
  </section>;
}

export default NormGuide;
