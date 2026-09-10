/**
 * The norm builder (R3-02, R3-O6): the pieces of the Norm screen that let a process expert calibrate a
 * norm in the browser instead of editing JSON.
 *
 * - the **rule editor** per constraint type, with pickers bound to this case table's own activities and
 *   attribute values and their counts (`GET …/norms/inventory`), so a rule can never name an activity the
 *   log does not have;
 * - the **applicability editor**: which flow types the expectation is meant for, an attribute restriction,
 *   or *not applicable to this log* with a note — the fifteen expectations of the extract that cannot fail
 *   or cannot pass are marked here;
 * - the **commit dialog**, which asks for a rationale **and** an owner before a threshold leaves the lens.
 *
 * Nothing here writes JSON the reader has to look at: every change is described in one sentence and saved
 * as the next version with its note.
 */
import { useMemo, useState } from "react";
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
  const list = (v: unknown) => (Array.isArray(v) ? v.join(" or ") : String(v ?? ""));
  switch (c.type) {
    case "presence":
      return `${list(p.activity)} happens at least ${String(p.m ?? 1)} time${Number(p.m ?? 1) === 1 ? "" : "s"}`;
    case "exclusion":
      return `${list(p.activity)} does not happen`;
    case "precedence":
      return `${list(p.a)} comes before ${list(p.b)}`;
    case "lag":
      return `${list(p.b)} follows ${list(p.a)} within ${String(p.delta)} ${unitWord(String(p.unit ?? "D"))}, tolerated to ${String(p.width)}`;
    case "singularity":
      return `${list(p.activity)} happens at most ${String(p.k)} time${Number(p.k ?? 1) === 1 ? "" : "s"}, tolerated to ${String(p.K)}`;
    case "metric":
      return `${quantityWords(String(p.attribute))} stays ${p.direction === "low" ? "at or above" : "at or below"} ${String(p.threshold)}`;
    case "balance":
      return `${quantityWords(String(p.attr_x))} and ${quantityWords(String(p.attr_y))} stay within ${String(p.tau)} of each other`;
    default:
      return c.description ?? c.type;
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
export function applicabilitySentence(c: Constraint, caseNoun: string): string {
  const a = (c.applicability ?? {}) as { flow_types?: string[]; attribute?: string; values?: string[]; not_applicable?: boolean; note?: string };
  if (a.not_applicable) return `Not applicable to this log${a.note ? ` — ${a.note}` : ""}.`;
  const parts: string[] = [];
  if (a.flow_types?.length) parts.push(`${a.flow_types.join(" and ")} flows`);
  if (a.attribute && a.values?.length) parts.push(`${quantityWords(a.attribute)} ${a.values.join(" or ")}`);
  return parts.length ? `Applies to ${parts.join(", ")}.` : `Applies to every one of these ${caseNoun}.`;
}

// ---------------------------------------------------------------- the pickers, bound to the log

function ActivityPicker({
  label,
  value,
  activities,
  onChange,
  caseNoun,
}: {
  label: string;
  value: string[];
  activities: ActivityInventory[];
  onChange: (next: string[]) => void;
  caseNoun: string;
}) {
  const [q, setQ] = useState("");
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return activities.filter((a) => !needle || a.label.toLowerCase().includes(needle)).slice(0, 60);
  }, [activities, q]);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium text-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle px-2 py-0.5 text-xs text-accent-text">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="rounded-full px-0.5 hover:bg-surface" onClick={() => onChange(value.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-text-subtle">nothing chosen yet</span>}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search the ${fmtInt(activities.length)} activities of this log`} className="h-8" aria-label={`${label}: search the activities of this log`} />
      <ul className="max-h-40 overflow-y-auto rounded border border-border" role="listbox" aria-multiselectable aria-label={`${label}: the activities of this log`}>
        {matching.map((a) => (
          <li key={a.label} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={value.includes(a.label)}
              className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-surface-sunken", value.includes(a.label) && "bg-selection")}
              onClick={() => onChange(value.includes(a.label) ? value.filter((x) => x !== a.label) : [...value, a.label])}
            >
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              <span className="tnum shrink-0 text-text-subtle">
                {fmtInt(a.cases)} {caseNoun}
                {a.share !== null && a.share !== undefined ? ` · ${fmtPct(a.share, 0)}` : ""}
              </span>
            </button>
          </li>
        ))}
        {matching.length === 0 && <li className="px-2 py-1 text-xs text-text-subtle">No activity of this log carries that word.</li>}
      </ul>
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
}

/** The parameters of one expectation, with every activity and attribute picked from the log itself. */
export function RuleEditor({ projectId, caseTableId, constraint, caseNoun, onChange }: RuleEditorProps) {
  const inventory = useQuery(inventoryQuery(projectId, caseTableId));
  const data = inventory.data as Inventory | undefined;
  const activities = (data?.activities ?? []) as ActivityInventory[];
  const attributes = (data?.attributes ?? []) as AttributeInventory[];
  // the inventory names the case notion itself, so the counts read "234,479 purchase order items"
  const noun = data?.caseNoun ?? caseNoun;
  const p = constraint.params;
  const set = (patch: Record<string, unknown>) => onChange({ ...constraint, params: { ...constraint.params, ...patch } });
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === "" ? [] : [String(v)]);

  if (inventory.isPending) return <LoadingBlock rows={4} />;
  if (inventory.isError) {
    return (
      <p className="reading text-sm text-text-muted" data-testid="inventory-unavailable">
        {notServed(inventory.error)
          ? "This backend does not list the log's activities and attributes, so the rule cannot be edited with pickers here. The rule is shown as it stands."
          : "The log's activities could not be read just now; the rule is shown as it stands."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="rule-editor">
      <p className="text-xs text-text-subtle">
        Every activity and value below is one this log actually has, with how many {noun} carry it: {fmtInt(activities.length)} activities, {fmtInt(attributes.length)} values.
      </p>
      {(constraint.type === "presence" || constraint.type === "exclusion" || constraint.type === "singularity") && (
        <ActivityPicker label="Which activity" value={asList(p.activity)} activities={activities} caseNoun={noun} onChange={(next) => set({ activity: next })} />
      )}
      {(constraint.type === "precedence" || constraint.type === "lag") && (
        <>
          <ActivityPicker label="First this" value={asList(p.a)} activities={activities} caseNoun={noun} onChange={(next) => set({ a: next })} />
          <ActivityPicker label="Then this" value={asList(p.b)} activities={activities} caseNoun={noun} onChange={(next) => set({ b: next })} />
        </>
      )}
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
          <Field label="tolerated to" htmlFor="rule-width">
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
            <Field label="this value" htmlFor="rule-threshold">
              <Input id="rule-threshold" type="number" className="w-28" value={String(p.threshold ?? "")} onChange={(e) => set({ threshold: Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
      <p className="reading rounded-md border border-border bg-surface-sunken p-2 text-sm" data-testid="rule-sentence">
        {ruleSentence(constraint)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- applicability

export interface ApplicabilityEditorProps {
  constraint: Constraint;
  flowTypes: { name: string; cases?: number }[];
  attributes: AttributeInventory[];
  caseNoun: string;
  onChange: (next: Constraint) => void;
}

/**
 * Which items an expectation is meant for — and, for the fifteen that cannot fail or cannot pass on a given
 * log, *not applicable to this log* with a note, so a layer-balanced score stops averaging constants.
 */
export function ApplicabilityEditor({ constraint, flowTypes, attributes, caseNoun, onChange }: ApplicabilityEditorProps) {
  const a = (constraint.applicability ?? {}) as { flow_types?: string[]; attribute?: string; values?: string[]; not_applicable?: boolean; note?: string };
  const set = (patch: Record<string, unknown>) => onChange({ ...constraint, applicability: { ...(constraint.applicability ?? {}), ...patch } });
  const chosen = attributes.find((x) => x.name === a.attribute);
  return (
    <div className="flex flex-col gap-3" data-testid="applicability-editor">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={!!a.not_applicable} onChange={(e) => set({ not_applicable: e.target.checked || undefined })} />
        <span>
          <span className="font-medium">Not applicable to this log</span>
          <span className="block text-xs text-text-muted">The expectation cannot fail or cannot pass here — the events it needs are not in this extract. It is then left out of the score instead of averaged as a constant.</span>
        </span>
      </label>
      {a.not_applicable && (
        <Field label="why (required)" htmlFor="applicability-note">
          <Textarea id="applicability-note" value={a.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder="This extract has no return and no invoice events, so the rule is never evaluated." />
        </Field>
      )}
      {!a.not_applicable && (
        <>
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
              {flowTypes.length === 0 && <span className="text-xs text-text-subtle">This case table has no flow types, so every {caseNoun} is the same kind.</span>}
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
        {applicabilitySentence(constraint, caseNoun)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the commit form

export interface CommitFields {
  rationale: string;
  owner: string;
}

/** A threshold is a human decision: it does not leave the lens without a reason and a name behind it. */
export function CommitFieldsForm({ value, onChange }: { value: CommitFields; onChange: (next: CommitFields) => void }) {
  return (
    <>
      <Field label="why this threshold (required)" htmlFor="commit-rationale">
        <Textarea id="commit-rationale" value={value.rationale} onChange={(e) => onChange({ ...value, rationale: e.target.value })} placeholder="What the distribution shows and what was agreed." autoFocus />
      </Field>
      <Field label="who owns it (required)" htmlFor="commit-owner">
        <Input id="commit-owner" value={value.owner} onChange={(e) => onChange({ ...value, owner: e.target.value })} placeholder="A name or a role — the person who answers for this number" />
      </Field>
    </>
  );
}

/** The chip that says a version is still a draft; the norm leaves `draft` only when a person says so. */
export function StatusChip({ status }: { status: string }) {
  return <Badge variant={status === "approved" ? "success" : status === "reviewed" ? "info" : "warning"}>{status === "draft" ? "draft — not yet signed" : status}</Badge>;
}

/** *Add your own expectation* — a blank constraint of the chosen type, in the chosen area. */
export function NewConstraintButton({ layers, onCreate }: { layers: { id: string; name: string }[]; onCreate: (c: Constraint) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("lag");
  const [layer, setLayer] = useState(layers[0]?.id ?? "");
  const [name, setName] = useState("");
  const canAdd = name.trim().length > 0 && layer.length > 0;
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-expectation">
        Add your own expectation
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      data-testid="new-expectation"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canAdd) return;
        const id = `c_own_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
        onCreate({ id, layer, type, params: type === "lag" ? { a: [], b: [], delta: 1, width: 3, unit: "D" } : {}, weight: 1, plain_name: name.trim(), description: name.trim() });
        setOpen(false);
        setName("");
      }}
    >
      <Field label="what it is called" htmlFor="new-name">
        <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shipped within the target time" />
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
        <Field label="which area" htmlFor="new-layer">
          <select id="new-layer" className="h-control rounded border border-border bg-surface px-2 text-sm" value={layer} onChange={(e) => setLayer(e.target.value)}>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canAdd}>
          Add it
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
