/**
 * The norm builder (R3-02, R3-O6): the pieces of the Norm screen that let a process expert calibrate a
 * norm in the browser instead of editing JSON.
 *
 * - the **rule editor** per constraint type, with pickers bound to this case table's own activities and
 *   attribute values and their counts (`GET …/norms/inventory`), retaining saved labels absent from the catalogue;
 * - the **applicability editor**: which flow types the expectation is meant for, an attribute restriction,
 *   or *not applicable to this log* with a note when an expectation is outside scope or cannot be judged;
 * - the **commit dialog**, with optional draft notes in Guided mode and required rationale in Expert mode.
 *
 * Nothing here writes JSON the reader has to look at: every change is described in one sentence and saved
 * as the next version with its note.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityInventory, AttributeInventory, Inventory } from "@/lib/api/norms";
import { inventoryQuery } from "@/lib/api/norms";
import { notServed } from "@/lib/api/compatibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { LoadingBlock } from "@/components/states";
import { fmtInt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";

export interface Constraint {
  id: string;
  layer: string;
  type: string;
  params: Record<string, unknown>;
  weight?: number;
  description?: string;
  plain_name?: string;
  applicability?: Record<string, unknown>;
}

/** What a threshold is called in each constraint type, and the two parameter names behind it. */
export function thresholdOf(c: Constraint): { threshold: number; width: number; keys: [string, string] } | undefined {
  const p = c.params;
  if (c.type === "lag") return { threshold: Number(p.delta), width: Number(p.width), keys: ["delta", "width"] };
  if (c.type === "metric") return { threshold: Number(p.threshold), width: Number(p.width), keys: ["threshold", "width"] };
  if (c.type === "singularity") return { threshold: Number(p.k), width: Number(p.K), keys: ["k", "K"] };
  if (c.type === "balance") return { threshold: Number(p.tau), width: Number(p.width), keys: ["tau", "width"] };
  return undefined;
}

/** The rule in one sentence, in the reader's words rather than as parameters. */
export function ruleSentence(c: Constraint): string {
  const p = c.params;
  const list = (v: unknown) => (Array.isArray(v) ? v.join(" or ") : String(v ?? "")) || "activity not set";
  const value = (v: unknown) => v == null || (typeof v === "number" && !Number.isFinite(v)) ? "not set" : String(v);
  const quantity = (v: unknown) => typeof v === "string" && v.trim() ? quantityWords(v) : "quantity not set";
  switch (c.type) {
    case "presence":
      return `${list(p.activity)} happens at least ${String(p.m ?? 1)} time${Number(p.m ?? 1) === 1 ? "" : "s"}`;
    case "exclusion":
      return `${list(p.activity)} does not happen`;
    case "precedence":
      return `${list(p.a)} comes before ${list(p.b)}`;
    case "lag":
      return `${list(p.b)} follows ${list(p.a)} within ${value(p.delta)} ${unitWord(String(p.unit ?? "D"))}, with ${value(p.width)} ${unitWord(String(p.unit ?? "D"))} of tolerance`;
    case "singularity":
      return `${list(p.activity)} happens at most ${value(p.k)} time${Number(p.k ?? 1) === 1 ? "" : "s"}, with a tolerance width of ${value(p.K)} occurrences`;
    case "metric":
      return `${quantity(p.attribute)} stays ${p.direction === "low" ? "at or above" : "at or below"} ${value(p.threshold)}`;
    case "balance":
      return `${quantity(p.attr_x)} and ${quantity(p.attr_y)} stay within ${value(p.tau)} of each other`;
    default:
      return `A generated summary is not available for the ${c.type} rule. Inspect its parameters in Settings → advanced controls.`;
  }
}

/**
 * The quantity a rule is about, in words (P1-13).
 *
 * A metric rule reads the column it measures, and the column is a column name: the norm step printed
 * *networth_cv stays at or below 0.35* and *manual_touch_count …*. The pack's own words come first; anything
 * else is the name with its underscores read as spaces, which is still the reader's language and never a
 * field as it is written in the file.
 */
const QUANTITY_WORDS: Record<string, string> = {
  manual_share: "the manual share",
  manual_touch_count: "the number of manual touches",
  manual_touches: "the number of manual touches",
  total_events: "the number of events",
  n_events: "the number of events",
  distinct_human_resources: "the number of people involved",
  distinct_resources: "the number of resources involved",
  networth_cv: "the spread of the item values",
  exposure: "the value at stake",
};
export const quantityWords = (attribute: string) => QUANTITY_WORDS[attribute] ?? attribute.replace(/^case /i, "").replace(/_/g, " ");

const UNITS: Record<string, string> = { D: "days", H: "hours", M: "minutes", S: "seconds" };
export const unitWord = (u: string) => UNITS[u] ?? u;

/** Applicability in one sentence: what the expectation is meant for. */
export interface ExclusionDraft {
  excluded: boolean;
  note: string;
}

export function applicabilitySentence(c: Constraint, caseNoun: string, exclusion?: ExclusionDraft): string {
  if (exclusion?.excluded) return `Not applicable to this log${exclusion.note ? ` — ${exclusion.note}` : ""}.`;
  const a = (c.applicability ?? {}) as { flow_types?: string[]; attribute?: string; values?: string[] };
  const extra = Object.keys(a).filter(key => !["flow_types", "attribute", "values"].includes(key));
  if (extra.length) return "Applies where the configured applicability condition is satisfied. Inspect the full condition under ‘who it applies to’.";
  const parts: string[] = [];
  if (a.flow_types?.length) parts.push(`${a.flow_types.join(" and ")} flows`);
  if (a.attribute && a.values?.length) parts.push(`${quantityWords(a.attribute)} ${a.values.join(" or ")}`);
  return parts.length ? `Applies to ${parts.join(", ")}.` : `Applies to every one of these ${caseNoun}.`;
}

// ---------------------------------------------------------------- the pickers, bound to the log

const knownCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const activityShare = (share: number | null | undefined, cases: number) => {
  if (share == null || !Number.isFinite(share) || share < 0 || share > 1 || (share === 0 && cases > 0)) return "share unknown";
  if (share > 0 && share < .01) return `<${fmtPct(.01, 0)}`;
  if (share > .99 && share < 1) return `>${fmtPct(.99, 0)}`;
  return fmtPct(share, 0);
};

function ActivityPicker({ label, value, activities, onChange, caseNoun, totalCases, catalogueAvailable = true }: {
  label: string;
  value: string[];
  activities: ActivityInventory[];
  onChange: (next: string[]) => void;
  caseNoun: string;
  totalCases?: number;
  catalogueAvailable?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [focusedLabel, setFocusedLabel] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const options = useRef(new Map<string, HTMLButtonElement>());
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return activities.filter(a => !needle || a.label.toLowerCase().includes(needle));
  }, [activities, q]);
  const matching = filtered.slice(0, 60);
  const unlisted = catalogueAvailable ? value.filter(label => !activities.some(activity => activity.label === label)) : [];
  const activeLabel = matching.some(a => a.label === focusedLabel) ? focusedLabel : matching.find(a => value.includes(a.label))?.label ?? matching[0]?.label;
  const focusOption = (index: number) => {
    const activity = matching[index];
    if (!activity) return;
    setFocusedLabel(activity.label);
    const option = options.current.get(activity.label);
    option?.focus();
    option?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium text-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {value.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle px-2 py-0.5 text-xs text-accent-text">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="rounded-full px-0.5 hover:bg-surface" onClick={() => { onChange(value.filter(x => x !== v)); searchRef.current?.focus(); }}>×</button>
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-text-subtle">nothing chosen yet</span>}
      </div>
      {unlisted.length > 0 && <p className="text-xs text-warning">Not found in this prepared table’s activity catalogue: {unlisted.join(", ")}. These entries remain in the rule; review the activity names or data mapping.</p>}
      {!catalogueAvailable && <p className="text-xs text-text-muted">Activity catalogue unavailable. Existing selections are kept.</p>}
      <Input ref={searchRef} value={q} onChange={event => { setQ(event.target.value); setFocusedLabel(undefined); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusOption(event.key === "ArrowDown" ? 0 : matching.length - 1); }
      }} placeholder={`Search the ${fmtInt(activities.length)} activities of this log`} className="h-8" aria-label={`${label}: search the activities of this log`} aria-controls={`${id}-options`} />
      <p id={`${id}-scope`} className="text-xs text-text-muted">Counts are {caseNoun} containing each activity. Total: {knownCount(totalCases) ? `${fmtInt(totalCases)} ${caseNoun}` : "unknown"}.</p>
      <p id={`${id}-keys`} className="text-xs text-text-muted">Arrow keys, Home and End move focus. Enter or Space toggles selection. Tab leaves the list.</p>
      <ul id={`${id}-options`} className="max-h-40 overflow-y-auto rounded border border-border" role="listbox" aria-multiselectable="true" aria-label={`${label}: the activities of this log`} aria-describedby={`${id}-scope ${id}-keys`} tabIndex={matching.length ? undefined : 0}>
        {matching.map((a, index) => (
          <li key={a.label} role="presentation">
            <button
              ref={element => { if (element) options.current.set(a.label, element); else options.current.delete(a.label); }}
              type="button"
              role="option"
              tabIndex={a.label === activeLabel ? 0 : -1}
              aria-selected={value.includes(a.label)}
              title={`${a.label}: ${knownCount(a.cases) ? String(a.cases) : "unknown"} / ${knownCount(totalCases) ? String(totalCases) : "unknown total"} ${caseNoun}; reported share: ${a.share == null ? "unknown" : String(a.share)} (fraction of cases)`}
              className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent", value.includes(a.label) && "bg-selection")}
              onFocus={() => setFocusedLabel(a.label)}
              onKeyDown={event => {
                const destination = event.key === "ArrowDown" ? Math.min(index + 1, matching.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? matching.length - 1 : undefined;
                if (destination !== undefined) { event.preventDefault(); focusOption(destination); }
              }}
              onClick={() => onChange(value.includes(a.label) ? value.filter(x => x !== a.label) : [...value, a.label])}
            >
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              <span className="tnum shrink-0 text-text-subtle">{knownCount(a.cases) ? `${fmtInt(a.cases)} ${caseNoun}` : "count unknown"} · {activityShare(a.share, a.cases)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="text-xs text-text-muted">{!matching.length ? "No activity of this log carries that word." : filtered.length > 60 ? `Showing the first 60 of ${fmtInt(filtered.length)} matching activities. Refine the search to find more.` : `${fmtInt(matching.length)} matching activities`}</p>
    </fieldset>
  );
}

function AttributePicker({ value, attributes, onChange }: { value: string; attributes: AttributeInventory[]; onChange: (next: string) => void }) {
  const chosen = attributes.find((a) => a.name === value);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium text-text-muted">Which value of the item</legend>
      <select className="h-control rounded border border-border bg-surface px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Which value of the item">
        <option value="">choose one</option>
        {value && !chosen && <option value={value}>{quantityWords(value)} — not in the available catalogue</option>}
        {attributes.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name.replace(/^case /, "")} — {fmtInt(a.distinct)} different values
          </option>
        ))}
      </select>
      {chosen?.values?.length ? (
        <p className="text-xs text-text-subtle">
          Most common: {chosen.values.slice(0, 3).map((v) => `${String(v.value)} (${fmtInt(v.cases)})`).join(", ")}
        </p>
      ) : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------- the rule editor

export interface RuleEditorProps {
  projectId: string;
  caseTableId: string;
  constraint: Constraint;
  caseNoun: string;
  onChange: (next: Constraint) => void;
  nameInvalid?: boolean;
}

/** The parameters of one expectation, with every activity and attribute picked from the log itself. */
function RuleActivities({ constraint, activities, data, noun, onChange }: {
  constraint: Constraint; activities: ActivityInventory[]; data: Inventory | undefined; noun: string;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { showAdvancedControls } = useNormAuthoringPreferences();
  const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : value == null || value === "" ? [] : [String(value)];
  const paired = constraint.type === "precedence" || constraint.type === "lag";
  const fields = paired ? [{ key: "a", label: "First this" }, { key: "b", label: "Then this" }] : [{ key: "activity", label: "Which activity" }];
  const [editing, setEditing] = useState(() => fields.some(field => list(constraint.params[field.key]).length === 0));
  const open = showAdvancedControls || editing;
  const catalogue = new Set(activities.map(activity => activity.label));
  const missing = [...new Set(fields.flatMap(field => list(constraint.params[field.key])).filter(label => !catalogue.has(label)))];
  const id = useId();
  return <section aria-label="Rule activities" className="space-y-3">
    {!open && missing.length > 0 && <p className="text-sm text-warning">{Array.isArray(data?.activities) ? "Not found in this prepared table’s activity catalogue" : "Activity catalogue unavailable; selected activities cannot be checked"}: {missing.join(", ")}. The saved rule is unchanged.</p>}
    {!showAdvancedControls && <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setEditing(value => !value)}>{open ? "Hide activity choices" : "Edit activities"}</Button>}
    {open && <div id={id} className="space-y-3">
      <p className="text-xs text-text-subtle">Activity counts cover all prepared cases in this table. They are not filtered to the current evidence population.</p>
      {fields.map(field => <ActivityPicker key={field.key} label={field.label} value={list(constraint.params[field.key])} activities={activities} totalCases={data?.cases} catalogueAvailable={Array.isArray(data?.activities)} caseNoun={noun} onChange={next => onChange({ [field.key]: next })} />)}
    </div>}
  </section>;
}

export function RuleEditor({ projectId, caseTableId, constraint, caseNoun, onChange, nameInvalid = false }: RuleEditorProps) {
  const inventory = useQuery(inventoryQuery(projectId, caseTableId));
  const data = inventory.data as Inventory | undefined;
  const activities = (data?.activities ?? []) as ActivityInventory[];
  const attributes = (data?.attributes ?? []) as AttributeInventory[];
  // the inventory names the case notion itself, so the counts read "234,479 purchase order items"
  const noun = data?.caseNoun ?? caseNoun;
  const p = constraint.params;
  const set = (patch: Record<string, unknown>) => onChange({ ...constraint, params: { ...constraint.params, ...patch } });

  const summary = <section aria-label="Rule from current settings" className="space-y-1 border-l-2 border-accent pl-3">
    <h3 className="text-xs font-semibold text-text-muted">Rule from current settings</h3>
    <p className="reading text-sm" data-testid="rule-sentence">{ruleSentence(constraint)}</p>
    <p className="text-xs text-text-muted">Generated from the current parameters. The constraint name is a separate label and is kept when targets change.</p>
  </section>;
  if (inventory.isPending) return <>{summary}<LoadingBlock rows={4} /></>;
  if (inventory.isError) {
    return (
      <div className="space-y-3">{summary}<p className="reading text-sm text-text-muted" data-testid="inventory-unavailable">
        {notServed(inventory.error)
          ? "This backend does not list the log's activities and attributes, so the rule cannot be edited with pickers here. The rule is shown as it stands."
          : "The log's activities could not be read just now; the rule is shown as it stands."}
      </p><Button type="button" size="sm" variant="outline" onClick={() => void inventory.refetch()}>Retry activities and attributes</Button></div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="rule-editor">
      <Field label="Constraint name" htmlFor="rule-name">
        <Input id="rule-name" required aria-required="true" value={constraint.plain_name ?? constraint.description ?? constraint.id} onChange={e => { const next = { ...constraint, description: e.target.value }; delete next.plain_name; onChange(next); }} aria-invalid={nameInvalid || undefined} aria-describedby={nameInvalid ? "rule-name-error" : undefined} className={nameInvalid ? "border-danger ring-1 ring-danger" : undefined} />
        {nameInvalid && <p id="rule-name-error" className="text-xs text-danger">Enter a name for this constraint.</p>}
      </Field>
      {summary}
      {["presence", "exclusion", "singularity", "precedence", "lag"].includes(constraint.type) && <RuleActivities key={`activities:${constraint.id}`} constraint={constraint} activities={activities} data={data} noun={noun} onChange={set} />}
      {constraint.type === "presence" && <Field label="Minimum occurrences" htmlFor="rule-minimum"><Input id="rule-minimum" className="w-24" type="number" min="1" step="1" value={String(p.m ?? 1)} onChange={e => set({ m: Number(e.target.value) })} /></Field>}
      {constraint.type === "singularity" && <div className="flex flex-wrap gap-3">
        <Field label="Maximum expected occurrences" htmlFor="rule-k"><Input id="rule-k" className="w-24" type="number" min="0" step="1" value={String(p.k ?? 1)} onChange={e => set({ k: Number(e.target.value) })} /></Field>
        <Field label="Tolerance width (occurrences)" htmlFor="rule-K"><Input id="rule-K" className="w-24" type="number" min="0.001" step="any" value={String(p.K ?? 1)} onChange={e => set({ K: Number(e.target.value) })} /></Field>
      </div>}
      {constraint.type === "balance" && <div className="space-y-3">
        <Field label="First quantity attribute" htmlFor="rule-balance-x"><Input id="rule-balance-x" value={String(p.attr_x ?? "")} onChange={e => set({ attr_x: e.target.value })} /></Field>
        <Field label="Second quantity attribute" htmlFor="rule-balance-y"><Input id="rule-balance-y" value={String(p.attr_y ?? "")} onChange={e => set({ attr_y: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-3"><Field label="Allowed relative difference" htmlFor="rule-tau"><Input id="rule-tau" className="w-24" type="number" min="0" step="any" value={String(p.tau ?? 0)} onChange={e => set({ tau: Number(e.target.value) })} /></Field><Field label="Tolerance width (relative difference)" htmlFor="rule-balance-width"><Input id="rule-balance-width" className="w-24" type="number" min="0.001" step="any" value={String(p.width ?? 1)} onChange={e => set({ width: Number(e.target.value) })} /></Field></div>
        <p className="text-xs text-text-muted">Quantities must use comparable units and the same object level. Derived attribute names can be entered here.</p>
      </div>}
      {constraint.type === "lag" && (
        <div className="flex flex-wrap gap-3">
          <Field label="within" htmlFor="rule-delta">
            <Input id="rule-delta" type="number" className="w-24" value={String(p.delta ?? "")} onChange={(e) => set({ delta: Number(e.target.value) })} />
          </Field>
          <Field label="in" htmlFor="rule-unit">
            <select id="rule-unit" className="h-control rounded border border-border bg-surface px-2 text-sm" value={String(p.unit ?? "D")} onChange={(e) => set({ unit: e.target.value })}>
              {Object.entries(UNITS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="tolerance width" htmlFor="rule-width">
            <Input id="rule-width" type="number" className="w-24" value={String(p.width ?? "")} onChange={(e) => set({ width: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      {constraint.type === "metric" && (
        <>
          <AttributePicker value={String(p.attribute ?? "")} attributes={attributes} onChange={(next) => set({ attribute: next })} />
          <div className="flex flex-wrap gap-3">
            <Field label="stays" htmlFor="rule-direction">
              <select id="rule-direction" className="h-control rounded border border-border bg-surface px-2 text-sm" value={String(p.direction ?? "high")} onChange={(e) => set({ direction: e.target.value })}>
                <option value="high">at or below</option>
                <option value="low">at or above</option>
              </select>
            </Field>
            <Field label="Tolerance width (metric units)" htmlFor="rule-metric-width"><Input id="rule-metric-width" className="w-24" type="number" min="0.001" step="any" value={String(p.width ?? 1)} onChange={e => set({ width: Number(e.target.value) })} /></Field>
            <Field label="this value" htmlFor="rule-threshold">
              <Input id="rule-threshold" type="number" className="w-28" value={String(p.threshold ?? "")} onChange={(e) => set({ threshold: Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
      <AdvancedRuleParameters key={constraint.id} params={p} onApply={params => onChange({ ...constraint, params })} />

    </div>
  );
}

// ---------------------------------------------------------------- applicability

export interface ApplicabilityEditorProps {
  constraint: Constraint;
  exclusion: ExclusionDraft;
  onExclusionChange: (next: ExclusionDraft) => void;
  noteInvalid?: boolean;
  flowTypes: { name: string; cases?: number }[];
  attributes: AttributeInventory[];
  caseNoun: string;
  onChange: (next: Constraint) => void;
}

function AdvancedRuleParameters({ params, onApply, applicability = false }: { params: Record<string, unknown>; onApply: (params: Record<string, unknown>) => void; applicability?: boolean }) {
  const { showAdvancedControls } = useNormAuthoringPreferences();
  const [text, setText] = useState(JSON.stringify(params, null, 2));
  const [error, setError] = useState("");
  useEffect(() => { setText(JSON.stringify(params, null, 2)); setError(""); }, [params]);
  if (!showAdvancedControls) return <p className="text-xs text-text-muted">Complete {applicability ? "applicability" : "rule"} parameters are available through Settings → Show advanced rule and list controls.</p>;
  return <details className="rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">{applicability ? "Advanced applicability clause" : "Advanced rule parameters"}</summary>
    <p className="my-2 text-xs text-text-muted">{applicability ? "Edit the complete applicability expression, including rare attribute values and compound conditions." : "Edit pairing, missing-event handling and other supported parameters."} Applying updates this form; save a new version to persist it. The backend validates semantics when saving.</p>
    <Field label={applicability ? "Applicability (JSON object)" : "Rule parameters (JSON object)"} htmlFor="rule-advanced"><Textarea id="rule-advanced" className="min-h-40 font-mono text-xs" value={text} onChange={e => { setText(e.target.value); setError(""); }} aria-invalid={!!error || undefined} /></Field>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    <Button className="mt-2" size="sm" variant="outline" onClick={() => { try { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); onApply(parsed as Record<string, unknown>); setError(""); } catch { setError("Enter a valid JSON object. The current rule is unchanged."); } }}>Apply parameters to form</Button>
  </details>;
}

/**
 * Which items an expectation is meant for, with a separate documented decision to exclude an expectation
 * that is outside the agreed business scope. Missing evidence alone does not establish an exclusion.
 */
export function ApplicabilityEditor({ constraint, exclusion, onExclusionChange, flowTypes, attributes, caseNoun, onChange, noteInvalid = false }: ApplicabilityEditorProps) {
  const a = (constraint.applicability ?? {}) as { flow_types?: string[]; attribute?: string; values?: string[] };
  const set = (patch: Record<string, unknown>) => onChange({ ...constraint, applicability: { ...(constraint.applicability ?? {}), ...patch } });
  const chosen = attributes.find((x) => x.name === a.attribute);
  return (
    <div className="flex flex-col gap-3" data-testid="applicability-editor">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={exclusion.excluded} onChange={(e) => onExclusionChange({ ...exclusion, excluded: e.target.checked })} />
        <span>
          <span className="font-medium">Not applicable to this log</span>
          <span className="block text-xs text-text-muted">Use this only when the business expectation is outside the agreed scope. This removes it from scoring in the new version. Missing evidence alone does not establish non-applicability; keep the rule and record an open evidence question in the guided overview.</span>
        </span>
      </label>
      {exclusion.excluded && (
        <Field label="why (required)" htmlFor="applicability-note">
          <Textarea id="applicability-note" required aria-required="true" value={exclusion.note} onChange={(e) => onExclusionChange({ ...exclusion, note: e.target.value })} placeholder="For these service purchases, receipt matching is outside the agreed business scope." aria-invalid={noteInvalid || undefined} aria-describedby={noteInvalid ? "applicability-note-error" : undefined} className={noteInvalid ? "border-danger ring-1 ring-danger" : undefined} />
          {noteInvalid && <p id="applicability-note-error" className="text-xs text-danger">Explain why this expectation is outside the agreed business scope.</p>}
        </Field>
      )}
      {!exclusion.excluded && (
        <>
          <AdvancedRuleParameters key={constraint.id} params={constraint.applicability ?? {}} applicability onApply={applicability => onChange({ ...constraint, applicability })} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-xs font-medium text-text-muted">Only these kinds of flow</legend>
            <div className="flex flex-wrap gap-1.5">
              {flowTypes.map((f) => {
                const on = (a.flow_types ?? []).includes(f.name);
                return (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={on}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-text-muted")}
                    onClick={() => set({ flow_types: on ? (a.flow_types ?? []).filter((x) => x !== f.name) : [...(a.flow_types ?? []), f.name] })}
                  >
                    {f.name}
                    {f.cases !== undefined ? ` · ${fmtInt(f.cases)}` : ""}
                  </button>
                );
              })}
              {flowTypes.length === 0 && <span className="text-xs text-text-subtle">Flow types have not been classified for this case table. This does not establish that all {caseNoun} follow the same process.</span>}
            </div>
          </fieldset>
          <AttributePicker value={a.attribute ?? ""} attributes={attributes} onChange={(next) => set({ attribute: next || undefined, values: undefined })} />
          {chosen?.values?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {chosen.values.slice(0, 10).map((v) => {
                const value = String(v.value);
                const on = (a.values ?? []).includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-text-muted")}
                    onClick={() => set({ values: on ? (a.values ?? []).filter((x) => x !== value) : [...(a.values ?? []), value] })}
                  >
                    {value} · {fmtInt(v.cases)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      )}
      <p className="reading rounded-md border border-border bg-surface-sunken p-2 text-sm" data-testid="applicability-sentence">
        {applicabilitySentence(constraint, caseNoun, exclusion)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the commit form

export interface CommitFields {
  rationale: string;
  owner: string;
}

/** Include only notes actually entered; saving a draft never invents a decision owner. */
export function normChangeNote(what: string, fields: CommitFields): string {
  return what + (fields.rationale.trim() ? ` — ${fields.rationale.trim()}` : "")
    + (fields.owner.trim() ? ` (owner: ${fields.owner.trim()})` : "");
}

export function CommitFieldsForm({ value, onChange, threshold = false, attempted = false, prefix = "commit", optional = false }: { value: CommitFields; onChange: (next: CommitFields) => void; threshold?: boolean; attempted?: boolean; prefix?: string; optional?: boolean }) {
  const reasonInvalid = !optional && attempted && !value.rationale.trim();
  const ownerInvalid = !optional && attempted && !value.owner.trim();
  const fields = <>
    <Field label={`${threshold ? "why this threshold" : "why this change"} (${optional ? "optional" : "required"})`} htmlFor={`${prefix}-rationale`}>
      <Textarea id={`${prefix}-rationale`} required={!optional} aria-required={!optional} value={value.rationale} onChange={(e) => onChange({ ...value, rationale: e.target.value })} placeholder={optional ? "Add context for this draft, if useful." : "What was agreed and why."} aria-invalid={reasonInvalid || undefined} aria-describedby={reasonInvalid ? `${prefix}-rationale-error` : undefined} className={reasonInvalid ? "border-danger ring-1 ring-danger" : undefined} />
      {reasonInvalid && <p id={`${prefix}-rationale-error`} className="text-xs text-danger">Explain why you are making this change.</p>}
    </Field>
    <Field label={`who owns it (${optional ? "optional" : "required"})`} htmlFor={`${prefix}-owner`}>
      <Input id={`${prefix}-owner`} required={!optional} aria-required={!optional} value={value.owner} onChange={(e) => onChange({ ...value, owner: e.target.value })} placeholder="A name or a role — who owns this decision" aria-invalid={ownerInvalid || undefined} aria-describedby={ownerInvalid ? `${prefix}-owner-error` : undefined} className={ownerInvalid ? "border-danger ring-1 ring-danger" : undefined} />
      {ownerInvalid && <p id={`${prefix}-owner-error`} className="text-xs text-danger">Enter the name or role that owns this decision.</p>}
    </Field>
  </>;
  return optional ? <details>
    <summary className="cursor-pointer text-sm font-medium">Add reason or owner (optional)</summary>
    <div className="mt-2 space-y-2">{fields}<p className="text-xs text-text-muted">These notes are saved with the draft. They do not confirm a threshold decision.</p></div>
  </details> : fields;
}

/** The chip that says a version is still a draft; the norm leaves `draft` only when a person says so. */
export function StatusChip({ status }: { status: string }) {
  return <Badge variant={status === "approved" ? "success" : status === "reviewed" ? "info" : "warning"}>{status === "draft" ? "draft — not yet signed" : status}</Badge>;
}

/** *Add constraint* — a blank constraint of the chosen type, in the chosen area. */
export function NewConstraintButton({ layers, onCreate }: { layers: { id: string; name: string }[]; onCreate: (c: Constraint) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("lag");
  const [layer, setLayer] = useState(layers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const canAdd = name.trim().length > 0 && layer.length > 0;
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-expectation">
        Add constraint
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      data-testid="new-expectation"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        if (!canAdd) { document.getElementById(!name.trim() ? "new-name" : "new-layer")?.focus(); return; }
        const id = `c_own_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
        onCreate({ id, layer, type, params: type === "lag" ? { a: [], b: [], delta: 1, width: 3, unit: "D" } : {}, weight: 1, description: name.trim() });
        setOpen(false);
        setAttempted(false);
        setName("");
      }}
    >
      <Field label="what it is called" htmlFor="new-name">
        <Input id="new-name" required aria-required="true" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shipped within the target time" aria-invalid={attempted && !name.trim() || undefined} aria-describedby={attempted && !name.trim() ? "new-name-error" : undefined} className={attempted && !name.trim() ? "border-danger ring-1 ring-danger" : undefined} />
        {attempted && !name.trim() && <p id="new-name-error" className="text-xs text-danger">Enter a name for the new constraint.</p>}
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label="what kind of rule" htmlFor="new-type">
          <select id="new-type" className="h-control rounded border border-border bg-surface px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="lag">one step follows another in time</option>
            <option value="presence">something must happen</option>
            <option value="exclusion">something must not happen</option>
            <option value="precedence">one step comes before another</option>
            <option value="singularity">something happens at most so often</option>
            <option value="metric">a value of the item stays within a bound</option>
          </select>
        </Field>
        <Field label="Layer" htmlFor="new-layer">
          <select id="new-layer" className="h-control rounded border border-border bg-surface px-2 text-sm" value={layer} onChange={(e) => setLayer(e.target.value)} aria-invalid={attempted && !layer || undefined} aria-describedby={attempted && !layer ? "new-layer-error" : undefined}>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {attempted && !layer && <p id="new-layer-error" className="text-xs text-danger">Choose a layer.</p>}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add it
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
