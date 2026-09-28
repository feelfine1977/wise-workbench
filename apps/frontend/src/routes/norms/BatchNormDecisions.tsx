import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { fmtSig } from "@/lib/format";
import { Field } from "@/components/ui/label";
import { normCalibrationQuery, normSignalQuery, useCreateNormVersion, type NormVersionCreate } from "@/lib/api/norms";
import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";
import { normChangeNote } from "./Builder";
import { constraintName, type NormDocument } from "./normAuthoring";
import { normRefusal } from "./normErrors";
import {
  batchNames, batchNumericRule, batchValue, batchVersionRequest, evidenceIssue, forEachBatchLimited,
  pendingBatchConstraints, signalCoverage, thresholdSettingsIssue,
  type BatchMode, type BatchPreviewRow, type SignalEvidence,
} from "./normBatchPolicy";

export interface BatchNormDecisionsProps {
  projectId: string;
  versionId: string;
  document: NormDocument;
  caseTableId?: string;
  selectionId?: string;
  onSaved: (id: string) => void;
  onConstraint: (id: string) => void;
}
type EvidenceState = { evidence?: SignalEvidence; error?: string; loading?: boolean };

/** Each saved-document/data context owns its selections, evidence and unsaved preview. */
export function BatchNormDecisions(props: BatchNormDecisionsProps) {
  return <BatchSession key={JSON.stringify([props.projectId, props.versionId, props.caseTableId, props.selectionId ?? null, props.document])} {...props} />;
}

function evidencePopulationIssue(evidence: SignalEvidence | undefined, selectionId?: string): string | undefined {
  if (!evidence) return undefined;
  const scope = evidence.data.scope;
  const matches = selectionId !== undefined
    ? scope?.kind === "saved_selection" && scope.selectionId === selectionId
    : (!scope?.kind || scope.kind === "all_cases") && !scope?.selectionId;
  return matches ? undefined : "Evidence belongs to a different or unknown population. Reload it for this selection.";
}

function batchScopeNote(versionId: string, caseTableId: string | undefined, selectionId: string | undefined, rows: BatchPreviewRow[]): string {
  const requestedScope = selectionId !== undefined ? { kind: "saved_selection", selectionId } : { kind: "all_cases" };
  const measuredEvidence = rows.filter(row => row.evidence).map(row => ({ constraintId: row.id, scope: row.evidence!.data.scope ?? null }));
  // CalibrationEntry rejects extra fields; the immutable version note retains evidence provenance.
  return " Review context: " + JSON.stringify({ normVersionId: versionId, caseTableId: caseTableId ?? null, requestedScope, constraintIds: rows.map(row => row.id) }) +
    (measuredEvidence.length ? ". Returned evidence scopes: " + JSON.stringify(measuredEvidence) : ". No signal evidence loaded for these decisions") + ".";
}

/** Preserve evidence checks without turning an unsigned target edit into a calibration decision. */
export function thresholdDraftRequest(document: NormDocument, versionId: string, rows: BatchPreviewRow[], caseTableId?: string, selectionId?: string): NormVersionCreate {
  if (!rows.length || !caseTableId) throw new Error("Choose threshold changes with measured evidence.");
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Each constraint can appear only once.");
  const byId = new Map(rows.map(row => [row.id, row]));
  const keys = new Set<string>();
  for (const row of rows) {
    const constraint = document.constraints?.find(c => c.id === row.id);
    const rule = constraint && batchNumericRule(constraint);
    if (!constraint || !rule || !row.after || !row.rule || row.rule.key !== rule.key || row.rule.targetKey !== rule.targetKey || row.rule.widthKey !== rule.widthKey) throw new Error("The preview no longer matches this rule.");
    const issue = evidencePopulationIssue(row.evidence, selectionId) ?? evidenceIssue(constraint, row.evidence, versionId, caseTableId) ?? thresholdSettingsIssue(constraint, String(row.after.target), String(row.after.width));
    if (issue) throw new Error(issue);
    keys.add(rule.key);
  }
  if (keys.size !== 1) throw new Error("Choose rules with the same measurement semantics.");
  return {
    parentId: versionId,
    norm: { ...document, constraints: (document.constraints ?? []).map(c => {
      const row = byId.get(c.id);
      return row?.after && row.rule ? { ...c, params: { ...c.params, [row.rule.targetKey]: row.after.target, [row.rule.widthKey]: row.after.width } } : c;
    }) },
    note: `Draft threshold settings. Evidence: norm ${versionId}, case table ${caseTableId}; ` + rows.map(row => {
      const coverage = signalCoverage(row.evidence!.data)!;
      return normChangeNote(`${row.id}: ${coverage.measured}/${coverage.scope} measured, loaded ${row.evidence!.loadedAt}`, row);
    }).join("; ") + batchScopeNote(versionId, caseTableId, selectionId, rows),
  };
}

function BatchSession({ projectId, versionId, document, caseTableId, selectionId, onSaved, onConstraint }: BatchNormDecisionsProps) {
  const { allowDraftWithoutDecision } = useNormAuthoringPreferences();
  const id = useId();
  const client = useQueryClient();
  const calibration = useQuery({ ...normCalibrationQuery(projectId, versionId), refetchOnMount: "always" });
  const create = useCreateNormVersion(projectId);
  const [mode, setMode] = useState<BatchMode>("decisions");
  const draftThresholds = mode === "thresholds" && allowDraftWithoutDecision;
  const [layer, setLayer] = useState("");
  const [type, setType] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rationale, setRationale] = useState("");
  const [owner, setOwner] = useState("");
  const [target, setTarget] = useState("");
  const [width, setWidth] = useState("");
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({});
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<BatchPreviewRow[]>();
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => { setPreview(undefined); setChosen([]); }, [draftThresholds]);
  const [issue, setIssue] = useState("");
  const [savedId, setSavedId] = useState<string>();
  const mounted = useRef(true);
  const saving = useRef(false);
  const loadingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const constraints = document.constraints ?? [];
  const pending = pendingBatchConstraints(document, calibration.data);
  const missing = calibration.data?.missingRationale ?? [];
  const readReady = calibration.isSuccess && calibration.data.normVersionId === versionId && !(calibration.data.canLeaveDraft === false && missing.length === 0);
  const busy = create.isPending || loading || !!savedId;
  const scopeRows = (mode === "decisions" ? pending : constraints.filter(c => batchNumericRule(c)))
    .filter(c => (!layer || c.layer === layer) && (!type || c.type === type));
  const groups = new Map<string, { label: string; names: string[] }>();
  for (const c of scopeRows) {
    const rule = batchNumericRule(c);
    if (!rule) continue;
    const old = groups.get(rule.key);
    groups.set(rule.key, { label: rule.label, names: [...(old?.names ?? []), constraintName(c)] });
  }
  const visible = mode === "decisions" ? scopeRows : scopeRows.filter(c => batchNumericRule(c)?.key === group);
  const selectedRows = visible.filter(c => selected.includes(c.id));
  const previewRows = (preview ?? []).filter(row => chosen.includes(row.id));
  const layerName = (key: string) => document.layers?.find(l => l.id === key)?.name ?? key;
  const invalidate = () => { setPreview(undefined); setChosen([]); setIssue(""); create.reset(); };
  const filterChange = (set: () => void) => { set(); setSelected([]); invalidate(); };
  const decisionFor = (key: string) => calibration.data?.thresholds?.find(row => row.constraint_id === key);

  const loadEvidence = async () => {
    if (!caseTableId || !selectedRows.length || loadingRef.current || busy) return;
    loadingRef.current = true;
    setLoading(true); invalidate();
    const rows = [...selectedRows];
    setEvidence(previous => ({ ...previous, ...Object.fromEntries(rows.map(c => [c.id, { loading: true }])) }));
    try {
      await forEachBatchLimited(rows, async c => {
        try {
          const data = await client.fetchQuery({ ...normSignalQuery(projectId, versionId, caseTableId, c.id, selectionId), staleTime: 0 });
          const loaded = { data, loadedAt: new Date().toISOString() };
          const populationIssue = evidencePopulationIssue(loaded, selectionId);
          if (mounted.current) setEvidence(previous => ({ ...previous, [c.id]: populationIssue ? { error: populationIssue } : { evidence: loaded } }));
        } catch {
          if (mounted.current) setEvidence(previous => ({ ...previous, [c.id]: { error: "Evidence could not be loaded. Retry loading selected evidence." } }));
        }
      }, () => mounted.current);
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  const preparePreview = () => {
    invalidate();
    if (!readReady || !selectedRows.length) { setIssue("Select pending decisions or compatible threshold rules first."); return; }
    if (!draftThresholds && (!rationale.trim() || !owner.trim())) { setIssue("Enter the shared reason and owner before previewing."); return; }
    if (mode === "thresholds") {
      const invalid = selectedRows.map(c => thresholdSettingsIssue(c, target, width)).find(Boolean);
      if (invalid) { setIssue(invalid); return; }
    }
    const rows: BatchPreviewRow[] = [];
    for (const c of selectedRows) {
      const row: BatchPreviewRow = { id: c.id, name: constraintName(c), rationale: rationale.trim(), owner: owner.trim() };
      if (mode === "thresholds") {
        const data = evidence[c.id]?.evidence;
        if (!caseTableId || evidencePopulationIssue(data, selectionId) || evidenceIssue(c, data, versionId, caseTableId)) continue;
        const rule = batchNumericRule(c)!;
        if (rule.target === Number(target) && rule.width === Number(width)) continue;
        rows.push({ ...row, rule, evidence: data, before: { target: rule.target, width: rule.width }, after: { target: Number(target), width: Number(width) } });
      } else rows.push(row);
    }
    if (!rows.length) { setIssue("No changes are ready. Load valid measurements and change a target or width, or review the constraints individually."); return; }
    setPreview(rows);
    setChosen(mode === "decisions" ? rows.map(r => r.id) : []);
  };

  const save = () => {
    if (saving.current || busy || !readReady || !previewRows.length) return;
    if (mode === "decisions" && previewRows.some(r => !missing.includes(r.id))) { setIssue("Review requirements changed. Preview the pending decisions again."); return; }
    try {
      if (mode === "thresholds") {
        const populationIssue = previewRows.map(row => evidencePopulationIssue(row.evidence, selectionId)).find(Boolean);
        if (populationIssue) throw new Error(populationIssue);
      }
      const body = draftThresholds
        ? thresholdDraftRequest(document, versionId, previewRows, caseTableId, selectionId)
        : batchVersionRequest(document, versionId, mode, previewRows, caseTableId);
      if (!draftThresholds) body.note += batchScopeNote(versionId, caseTableId, selectionId, previewRows);
      saving.current = true;
      create.mutate(body, {
        onSuccess: result => {
          if (!mounted.current) return;
          setSavedId(result.id);
          onSaved(result.id);
        },
        onSettled: () => { saving.current = false; },
      });
    } catch (error) { setIssue(error instanceof Error ? error.message : "Review these changes before saving."); }
  };

  return (
    <section aria-label="Batch norm decisions" className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Review several constraints</h3>
        <p className="text-sm text-text-muted">Choose the constraints that share a decision, check every row, then save one new draft. Review and approval remain separate actions.</p>
        <p className="text-xs text-text-muted">Evidence context: norm {versionId} · {caseTableId ? "case table " + caseTableId : "no mapped case table selected"} · {selectionId !== undefined ? `selected cohort ${selectionId}` : caseTableId ? "all prepared cases" : "population unavailable"}. Views only change weighting.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Batch operation">
        <Button type="button" variant={mode === "decisions" ? "default" : "outline"} disabled={busy} aria-pressed={mode === "decisions"} onClick={() => filterChange(() => { setMode("decisions"); setGroup(""); })}>Pending decisions</Button>
        <Button type="button" variant={mode === "thresholds" ? "default" : "outline"} disabled={busy} aria-pressed={mode === "thresholds"} onClick={() => filterChange(() => { setMode("thresholds"); setGroup(""); })}>Batch threshold settings</Button>
      </div>
      {calibration.isPending && <p role="status">Loading review requirements…</p>}
      {!calibration.isPending && !readReady && <div role="alert">Review requirements could not be checked. Your entries are kept. <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void calibration.refetch()}>Retry requirements</Button></div>}
      {readReady && <p className="text-sm">{missing.length} pending decisions · {constraints.length - pending.length} other constraints kept unchanged unless explicitly edited.</p>}
      <fieldset disabled={busy} className="space-y-3">
        <legend className="sr-only">Choose constraints and shared decision</legend>
        <div className="flex flex-wrap gap-3">
          <Field label="Filter by layer" htmlFor={id + "-layer"}><select id={id + "-layer"} className="h-control rounded border border-border bg-surface px-2 text-sm" value={layer} onChange={e => filterChange(() => { setLayer(e.target.value); setGroup(""); })}>
            <option value="">All layers</option>{[...new Set(constraints.map(c => c.layer))].map(value => <option key={value} value={value}>{layerName(value)}</option>)}
          </select></Field>
          <Field label="Filter by rule type" htmlFor={id + "-type"}><select id={id + "-type"} className="h-control rounded border border-border bg-surface px-2 text-sm" value={type} onChange={e => filterChange(() => { setType(e.target.value); setGroup(""); })}>
            <option value="">All types</option>{[...new Set(constraints.map(c => c.type))].map(value => <option key={value} value={value}>{value}</option>)}
          </select></Field>
        </div>
        {mode === "thresholds" && <div className="space-y-2">
          <p className="text-sm text-text-muted">Enter a business target explicitly. Observed percentiles describe the data; they are not an agreed SLA or control limits. Rules are grouped by type, unit, direction, applicability and measurement semantics.</p>
          <Field label="Compatible threshold group" htmlFor={id + "-group"}><select id={id + "-group"} className="h-control max-w-full rounded border border-border bg-surface px-2 text-sm" value={group} onChange={e => filterChange(() => setGroup(e.target.value))}>
            <option value="">Choose matching rules</option>{[...groups].map(([key, value]) => <option key={key} value={key}>{value.label + " · " + value.names[0] + " (" + value.names.length + ")"}</option>)}
          </select></Field>
          <p className="text-xs text-text-muted">Per-activation lags and rules without supported numeric parameters require individual review.</p>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!readReady || !visible.length} onClick={() => { setSelected(visible.map(c => c.id)); invalidate(); }}>Select visible {mode === "decisions" ? "pending" : "rules"}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!selected.length} onClick={() => { setSelected([]); invalidate(); }}>Clear selection</Button>
          <span className="text-sm" role="status">{selectedRows.length} selected</span>
        </div>
        <ul aria-label="Batch constraints" className="max-h-72 space-y-2 overflow-y-auto overscroll-contain">
          {visible.map(c => {
            const checked = selected.includes(c.id), state = evidence[c.id];
            const data = state?.evidence?.data;
            const coverage = data && signalCoverage(data);
            const problem = mode === "thresholds" && caseTableId ? state?.error ?? evidencePopulationIssue(state?.evidence, selectionId) ?? evidenceIssue(c, state?.evidence, versionId, caseTableId) : undefined;
            const old = decisionFor(c.id);
            return <li key={c.id} className="space-y-1 rounded border border-border p-2 text-sm">
              <div className="flex items-start gap-2">
                <label className="flex min-w-0 flex-1 items-start gap-2"><input type="checkbox" className="mt-1" checked={checked} disabled={!readReady} onChange={() => { setSelected(previous => checked ? previous.filter(key => key !== c.id) : [...previous, c.id]); invalidate(); }} /><span className="break-words">{constraintName(c)}<span className="block text-xs text-text-muted">{layerName(c.layer)} · {c.type}</span></span></label>
                <Button type="button" size="sm" variant="ghost" aria-label={"Open " + constraintName(c)} onClick={() => onConstraint(c.id)}>Open constraint</Button>
              </div>
              {mode === "decisions" && <p className="text-xs text-text-muted">Saved reason: {old?.rationale || "not recorded"} · Owner: {old?.owner || "not recorded"}</p>}
              {mode === "thresholds" && <>
                {state?.loading ? <p role="status">Loading evidence…</p> : problem && <p className="text-xs text-warning">{problem}</p>}
                {coverage && <p className="text-xs">{coverage.measured} measured / {coverage.scope} in scope · {coverage.missing} missing signals. Threshold shares use measured cases.</p>}
                {data && <p className="text-xs text-text-muted">Observed median: {typeof data.stats?.median === "number" && Number.isFinite(data.stats.median) ? fmtSig(data.stats.median, 6) : "unavailable"}; 90th percentile: {typeof data.stats?.p90 === "number" && Number.isFinite(data.stats.p90) ? fmtSig(data.stats.p90, 6) : "unavailable"} {data.unit}. {data.note}</p>}
              </>}
            </li>;
          })}
        </ul>
        {readReady && !visible.length && <p className="text-sm text-text-muted">{mode === "thresholds" && !group ? "Choose a compatible group to select rules." : "No constraints match these filters."}</p>}
        {mode === "thresholds" && <>
          {!caseTableId && <p className="text-sm text-warning">Select a mapped case table before loading threshold evidence.</p>}
          <Button type="button" variant="outline" disabled={!caseTableId || !selectedRows.length || !readReady} onClick={() => void loadEvidence()}>Load selected evidence</Button>
          <p className="text-xs text-text-muted">Loads at most three distributions at a time, only after you ask. Unavailable measurements remain unresolved.</p>
          <div className="flex flex-wrap gap-3">
            <Field label="New target" htmlFor={id + "-target"}><Input id={id + "-target"} type="number" step="any" value={target} onChange={e => { setTarget(e.target.value); invalidate(); }} /></Field>
            <Field label="New tolerance width" htmlFor={id + "-width"}><Input id={id + "-width"} type="number" step="any" min={0} value={width} onChange={e => { setWidth(e.target.value); invalidate(); }} /></Field>
          </div>
        </>}
        {draftThresholds && <p className="text-xs text-text-muted">These targets will be saved as a draft. Threshold decisions remain pending.</p>}
        {allowDraftWithoutDecision && mode === "decisions" && <p className="text-xs text-text-muted">Confirming pending decisions still needs a reason and owner. Use Batch threshold settings to save targets without confirming decisions.</p>}
        <details open={!draftThresholds || undefined}>
          <summary className="cursor-pointer text-sm font-medium">{draftThresholds ? "Add shared reason or owner (optional)" : "Shared reason and owner"}</summary>
          <div className="mt-2 space-y-2">
            <Field label="Shared decision reason" htmlFor={id + "-reason"}><Textarea id={id + "-reason"} required={!draftThresholds} aria-required={!draftThresholds} value={rationale} onChange={e => { setRationale(e.target.value); invalidate(); }} /></Field>
            <Field label="Shared decision owner" htmlFor={id + "-owner"}><Input id={id + "-owner"} required={!draftThresholds} aria-required={!draftThresholds} value={owner} onChange={e => { setOwner(e.target.value); invalidate(); }} /></Field>
            <p className="text-xs text-text-muted">{draftThresholds ? "Optional notes are kept in the version note and do not confirm threshold decisions." : "Use a shared reason only when it explains every selected decision."}</p>
          </div>
        </details>
        <Button type="button" variant="outline" disabled={!readReady || !selectedRows.length || (mode === "thresholds" && !caseTableId)} onClick={preparePreview}>Preview selected {mode === "decisions" ? "decisions" : "threshold settings"}</Button>
      </fieldset>
      {issue && <p role="alert" className="text-sm text-danger">{issue}</p>}
      {preview && <section aria-label="Batch change preview" className="space-y-3 border-t border-border pt-3">
        <h4 className="text-sm font-semibold">Check each proposed decision</h4>
        <p className="text-sm">{preview.length} ready for preview · {selectedRows.length - preview.length} selected items omitted because evidence is unavailable or values are unchanged.</p>
        {mode === "thresholds" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setChosen(preview.map(row => row.id)); create.reset(); }}>Choose all previewed changes</Button>}
        <ul className="max-h-80 space-y-3 overflow-y-auto overscroll-contain">
          {preview.map(row => {
            const coverage = row.evidence && signalCoverage(row.evidence.data);
            return <li key={row.id} className="space-y-1 rounded border border-border p-3 text-sm">
              <label className="flex items-start gap-2 font-medium"><input type="checkbox" className="mt-1" checked={chosen.includes(row.id)} disabled={busy} onChange={e => { setChosen(previous => e.target.checked ? [...previous, row.id] : previous.filter(key => key !== row.id)); create.reset(); }} /><span>Apply {row.name}</span></label>
              <p>Reason: {row.rationale || "Not recorded"}</p><p>Owner: {row.owner || "Not recorded"}</p>
              {row.before && row.after && row.rule && <>
                <p>Target: {batchValue(row.before.target)} → {batchValue(row.after.target)} {row.rule.unit} ({row.rule.direction === "high" ? "at most" : "at least"})</p>
                <p>Tolerance width: {batchValue(row.before.width)} → {batchValue(row.after.width)} {row.rule.unit}</p>
                <p>Full penalty: {batchValue(row.rule.direction === "high" ? row.before.target + row.before.width : row.before.target - row.before.width)} → {batchValue(row.rule.direction === "high" ? row.after.target + row.after.width : row.after.target - row.after.width)} {row.rule.unit}</p>
              </>}
              {coverage && row.evidence && <p className="text-xs text-text-muted">Evidence: norm {row.evidence.data.normVersionId} · case table {row.evidence.data.caseTableId} · {coverage.measured}/{coverage.scope} measured, {coverage.missing} missing · {selectionId !== undefined ? `selected cohort ${row.evidence.data.scope?.selectionName || selectionId}` : "all prepared cases"} · loaded {row.evidence.loadedAt}. Observed data supports review; no new score is claimed.</p>}
              {mode === "decisions" && <p className="text-xs text-text-muted">Threshold and applicability remain unchanged.</p>}
            </li>;
          })}
        </ul>
        <p className="text-xs text-text-muted">Only chosen rows will be saved. Unselected decisions retain their current state.</p>
        <Button type="button" disabled={busy || !readReady || !previewRows.length} onClick={save}>{create.isPending ? "Saving…" : "Save " + previewRows.length + " selected " + (mode === "decisions" ? "decisions" : "threshold changes") + " as new draft"}</Button>
      </section>}
      {create.isError && <p role="alert" className="text-sm text-danger">The draft could not be confirmed. Your selections and entries are kept. {normRefusal(create.error, batchNames(document), "save")}</p>}
      {savedId && <p role="status" className="text-sm">Saved draft {savedId}. Review requirements must be checked on that draft before signing.</p>}
    </section>
  );
}

export default BatchNormDecisions;
