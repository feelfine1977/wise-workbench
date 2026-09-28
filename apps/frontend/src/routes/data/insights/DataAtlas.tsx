import { useId, useState } from "react";
import { scaleLinear } from "d3";
import { Fingerprint, Layers3, ListTree } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import type { EDAResult } from "@/lib/api/eda";
import { fmtInt, fmtShare, fmtSig } from "@/lib/format";

interface AtlasField {
  name: string;
  dataType: string;
  role: "case_id" | "events" | "timestamp" | "attribute";
  distinct: number;
  missing: { selected: number; total: number };
  numeric: { min: number | null; max: number | null; median: number | null; p90: number | null } | null;
}

// A structural bridge while the generated EDAResponse acquires insights. A full
// generated response remains assignable; this component consumes only fields.
export interface DataAtlasProps {
  data: Omit<EDAResult, "insights"> & { insights?: { fields: AtlasField[] } | null };
  onExploreField: (field: string) => void;
  onMissingField: (field: string) => void;
}

const PREVIEW_FIELDS = 12;
const roles: Record<AtlasField["role"], { label: string; description: string }> = {
  case_id: { label: "Case identifier", description: "Identifies one case in the prepared table. An identifier does not establish the business meaning of a case." },
  events: { label: "Event count", description: "The number of recorded events belonging to a case. More events do not by themselves mean more work or rework." },
  timestamp: { label: "Recorded time", description: "A recorded case boundary. First and last recorded timestamps do not establish business start or completion." },
  attribute: { label: "Context attribute", description: "A case-level value available for grouping and selection. Differences between groups do not establish cause." },
};

function FieldRow({ field, selectedCases, totalCases, onExploreField, onMissingField }: {
  field: AtlasField;
  selectedCases: number;
  totalCases: number;
  onExploreField: DataAtlasProps["onExploreField"];
  onMissingField: DataAtlasProps["onMissingField"];
}) {
  const titleId = useId();
  const recorded = selectedCases - field.missing.selected;
  const completeness = selectedCases > 0 ? recorded / selectedCases : null;
  const width = scaleLinear().domain([0, Math.max(1, selectedCases)]).range([0, 100]).clamp(true)(recorded);
  const role = roles[field.role];
  return <li className="min-w-0 border-t border-border py-4">
    <article aria-labelledby={titleId}>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <h4 id={titleId} className="break-words font-mono text-sm font-semibold [overflow-wrap:anywhere]">{field.name}</h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className={`rounded-full px-2 py-0.5 ${field.role === "attribute" ? "bg-info-subtle text-info" : "bg-surface-sunken text-text-muted"}`}>{role.label}</span>
            <span className="break-words font-mono [overflow-wrap:anywhere]">{field.dataType}</span>
          </div>
          <p className="mt-2 text-xs text-text-muted"><strong className="font-medium text-text">{fmtInt(field.distinct)}</strong> distinct nonmissing values · all prepared cases</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium">{completeness === null ? "No selected cases" : `${fmtShare(completeness)} recorded in this selection`}</p>
          <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-sunken">
            {completeness !== null && <>
              <span className="block h-full bg-accent" style={{ width: `${width}%` }} />
              <span className="block h-full bg-warning-subtle" style={{ width: `${100 - width}%`, backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, var(--color-warning) 3px, var(--color-warning) 4px)" }} />
            </>}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">{fmtInt(field.missing.selected)} missing of {fmtInt(selectedCases)} selected cases</p>
        </div>
        {field.role === "attribute" && <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="outline" size="sm" aria-label={`Explore ${field.name}`} onClick={() => onExploreField(field.name)}>Explore field <span aria-hidden="true">→</span></Button>
          {field.missing.selected > 0 && <Button variant="ghost" size="sm" aria-label={`Select cases missing ${field.name}`} onClick={() => onMissingField(field.name)}>Select missing</Button>}
        </div>}
      </div>
      <details className="mt-2 text-xs">
        <summary className="w-fit cursor-pointer rounded py-1 text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Details for ${field.name}`}>Field details{field.numeric ? " & numeric summary" : ""}</summary>
        <div className="mt-2 space-y-3 rounded-md bg-surface-sunken p-3">
          <p className="max-w-prose text-text-muted">{role.description}</p>
          <p><strong className="font-medium">Whole-table coverage:</strong> {fmtInt(field.missing.total)} missing of {fmtInt(totalCases)} prepared cases. Distinct values above also describe the whole table.</p>
          {field.numeric && <div>
            <p className="font-medium">Numeric values in the current selection</p>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([ ["Minimum", field.numeric.min], ["Median", field.numeric.median], ["90th percentile", field.numeric.p90], ["Maximum", field.numeric.max] ] as const).map(([label, value]) => <div key={label}>
                <dt className="text-text-muted">{label}</dt>
                <dd className="mt-1 break-words font-semibold tnum" title={value === null ? undefined : String(value)}>{value === null || !Number.isFinite(value) ? "Unknown" : fmtSig(value, 5)}</dd>
              </div>)}
            </dl>
            <p className="mt-2 text-text-muted">Missing and nonfinite values are excluded. Values use the field’s recorded units; no business unit is inferred.</p>
          </div>}
        </div>
      </details>
    </article>
  </li>;
}

/** Structure first, then a searchable case-field dictionary; no event-log facts are inferred. */
export function DataAtlas({ data, onExploreField, onMissingField }: DataAtlasProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const fields = data.insights?.fields;
  const selectedCases = data.summary.cases.selected;
  const totalCases = data.summary.cases.total;
  const attributes = fields?.filter((field) => field.role === "attribute");
  const missingEventCounts = fields?.find((field) => field.role === "events")?.missing.selected;
  const allEventCountsUnknown = selectedCases > 0 && missingEventCounts === selectedCases;
  const query = search.trim().toLocaleLowerCase();
  const matching = (fields ?? []).filter((field) => `${field.name} ${field.dataType} ${field.role} ${roles[field.role].label}`.toLocaleLowerCase().includes(query));
  const visible = showAll ? matching : matching.slice(0, PREVIEW_FIELDS);
  const isSearching = query.length > 0;

  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-5">
    <header>
      <p className="text-xs font-medium uppercase tracking-wide text-accent-text">Structure & fields</p>
      <h2 id={`${id}-title`} className="mt-1 text-xl font-semibold">Get to know the records</h2>
      <p className="mt-2 max-w-prose text-sm text-text-muted">A case brings recorded events together. Context fields describe those cases and help you choose which ones to explore.</p>
    </header>

    <Card className="overflow-hidden bg-gradient-to-br from-accent-subtle via-surface to-info-subtle">
      <figure aria-labelledby={`${id}-composition`}>
        <figcaption id={`${id}-composition`} className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">How this dataset fits together</span>
          <span className="rounded-full border border-border bg-surface px-2 py-1 text-xs">Case unit: {data.caseNoun || "cases"}</span>
        </figcaption>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
            <dt className="flex items-center gap-2 text-sm font-medium"><Fingerprint className="size-5 text-accent-text" aria-hidden="true" />Selected cases</dt>
            <dd className="mt-2 break-words text-3xl font-semibold tnum text-accent-text">{fmtInt(selectedCases)}</dd>
            <dd className="mt-1 text-xs text-text-muted">of {fmtInt(totalCases)} prepared cases</dd>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
            <dt className="flex items-center gap-2 text-sm font-medium"><ListTree className="size-5 text-info" aria-hidden="true" />Recorded events</dt>
            <dd className="mt-2 break-words text-3xl font-semibold tnum text-info">{allEventCountsUnknown ? "Unknown" : fmtInt(data.summary.events.selected)}</dd>
            <dd className="mt-1 text-xs text-text-muted">{allEventCountsUnknown ? "Event counts are missing for every selected case" : "Recorded steps belonging to these cases"}</dd>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-surface p-4">
            <dt className="flex items-center gap-2 text-sm font-medium"><Layers3 className="size-5 text-accent-text" aria-hidden="true" />Context fields</dt>
            <dd className="mt-2 break-words text-3xl font-semibold tnum text-accent-text">{attributes ? fmtInt(attributes.length) : "Unavailable"}</dd>
            <dd className="mt-1 text-xs text-text-muted">Case attributes in this profile</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-muted">Cases group events; context fields describe cases. Case and event counts follow your selection. The field inventory stays the same.</p>
        {typeof missingEventCounts === "number" && missingEventCounts > 0 && !allEventCountsUnknown && <p className="mt-2 text-xs text-text-muted">Event totals include known counts only; {fmtInt(missingEventCounts)} selected cases have an unknown event count.</p>}
      </figure>
    </Card>

    <Card role="region" aria-labelledby={`${id}-dictionary`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${id}-dictionary`} className="text-base font-semibold">Data dictionary</h3>
          <p className="mt-1 text-sm text-text-muted">{fields ? `${fmtInt(fields.length)} profiled fields` : "Field profiles unavailable"} · prepared case table</p>
        </div>
        {fields && fields.length > 0 && <label htmlFor={`${id}-search`} className="w-full text-xs font-medium sm:max-w-80">
          Search all profiled fields
          <Input id={`${id}-search`} type="search" className="mt-1" placeholder="Field name, role or type…" value={search} onChange={(event) => { setSearch(event.target.value); setShowAll(false); }} />
        </label>}
      </div>
      <p className="mt-3 max-w-prose text-xs text-text-muted">Completeness uses selected cases. Distinct values use all prepared cases. Open a field’s details for coverage and numeric summaries.</p>
      {!fields ? <p className="mt-4 rounded-md bg-surface-sunken p-3 text-sm">Field profiles are not available for this dataset view. Case and event totals above still describe your selection.</p> : fields.length === 0 ? <p className="mt-4 text-sm">No field profiles are available in this prepared table.</p> : <>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
          <p role="status">Showing {fmtInt(visible.length)} of {fmtInt(matching.length)} {isSearching ? "matching fields" : "fields"}{isSearching ? ` · ${fmtInt(fields.length)} in the full profile` : ""}</p>
          <p><span aria-hidden="true" className="mr-1 inline-block h-2 w-3 rounded bg-accent" />Filled: recorded · striped: missing</p>
        </div>
        {selectedCases === 0 && <p className="mt-3 rounded-md bg-surface-sunken p-3 text-sm">No cases match the current selection. The field inventory is unchanged; selected completeness and numeric summaries are unavailable.</p>}
        {matching.length > 0 ? <ul id={`${id}-fields`} className="mt-3" aria-label="Profiled fields">
          {visible.map((field) => <FieldRow key={field.name} field={field} selectedCases={selectedCases} totalCases={totalCases} onExploreField={onExploreField} onMissingField={onMissingField} />)}
        </ul> : <p className="mt-4 text-sm">No fields match “{search}”. Try a field name, role or type.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {matching.length > PREVIEW_FIELDS && <Button variant="outline" size="sm" aria-expanded={showAll} aria-controls={`${id}-fields`} onClick={() => setShowAll((value) => !value)}>{showAll ? `Show first ${PREVIEW_FIELDS}` : `Show all ${fmtInt(matching.length)}${isSearching ? " matches" : " fields"}`}</Button>}
          {isSearching && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setShowAll(false); }}>Clear search</Button>}
        </div>
        <details className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
          <summary className="w-fit cursor-pointer rounded py-1 font-medium text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Which fields are included?</summary>
          <p className="mt-2 max-w-prose">This profile includes the case identifier, event count, recorded timestamps and up to 128 available scalar context attributes. It is a prepared-case dictionary, not an inventory of every column in the raw event log. Missing values follow the preparation’s missing-value rules.</p>
        </details>
      </>}
    </Card>

    <aside aria-labelledby={`${id}-limits`} className="rounded-lg border border-border bg-surface-sunken p-4">
      <h3 id={`${id}-limits`} className="text-sm font-semibold">What these records cannot tell us on their own</h3>
      <p className="mt-1 max-w-prose text-sm text-text-muted">Missing is unknown, not zero. First-to-last recorded span does not establish business completion or active work time. A difference between groups is an association, not evidence of cause.</p>
    </aside>
  </section>;
}

export default DataAtlas;
