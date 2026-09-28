import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "@/components/ui";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { edaQuery, type EDAJointPredicate, type EDANumericFacet, type EDAHierarchy } from "@/lib/api/eda";
import type { ContextChoice } from "@/lib/stores/analysisSelection";
import { ContextIcicle } from "./ContextIcicle";
import { fmtInt } from "@/lib/format";
import { explorerParams, compareDecimal, numericLabel, contextPath, matchesContextPath, type ExplorerScope } from "./selectionHelpers";

export function ExactValues({ scope, field, choices, onChange }: {
  scope: ExplorerScope; field: string; choices: ContextChoice[]; onChange: (choices: ContextChoice[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({ ...edaQuery(scope.projectId, scope.caseTableId, {
    ...explorerParams(scope), valueField: field, valueSearch: submitted, valuePage: page,
  }), enabled: open });
  const values = query.data?.values;
  return <div className="eda-exact-values">
    <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>Find any {field} value</Button>
    {open && <div className="mt-3 space-y-3">
      <p className="eda-note">Search every recorded value, including the long tail. Exact values join this field’s selected buckets with OR. Other still includes the whole tail.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(search); setPage(1); }}>
        <label className="min-w-0 text-sm">Search {field}<Input value={search} maxLength={256} onChange={(e) => setSearch(e.target.value)} /></label>
        <Button type="submit" size="sm">Search values</Button>
      </form>
      {query.isPending && <LoadingBlock />}
      {query.isError && <ErrorBlock error={query.error} retry={() => void query.refetch()} />}
      {values && !query.isError && <>
        <p className="text-xs text-text-muted">{fmtInt(values.totalValues)} matching values · selected / all cases</p>
        <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label={`Exact ${field} values`}>
          {values.rows.map((row) => {
            const selected = choices.some((c) => c.value === row.value);
            return <li key={row.value}><button className="eda-value-option" aria-pressed={selected} disabled={!row.selectable || (!selected && choices.filter((c) => c.value !== undefined).length >= 50)} title={row.selectable ? row.value : "Value exceeds the 4,096-character predicate limit"} onClick={() => onChange(selected ? choices.filter((c) => c.value !== row.value) : [...choices, { key: `value:${row.value}`, label: row.value, value: row.value }])}>
              <span className="break-all">{row.value}</span><span className="shrink-0 tnum">{fmtInt(row.selected)} / {fmtInt(row.total)}</span>
            </button></li>;
          })}
        </ul>
        {!values.rows.length && <p>No matching values.</p>}
        <div className="flex items-center gap-3"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous values</Button><span className="text-xs">Page {page}</span><Button size="sm" variant="ghost" disabled={page * values.pageSize >= values.totalValues} onClick={() => setPage(page + 1)}>Next values</Button></div>
      </>}
    </div>}
  </div>;
}

export function NumericRangeControl({ field, dataType, current, onChange }: {
  field: string; dataType: string; current?: EDANumericFacet; onChange: (next: EDANumericFacet | undefined) => void;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const min = String(form.get("lower") ?? "").trim(), max = String(form.get("upper") ?? "").trim();
    const missing = form.get("missing") === "on";
    const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
    if ((!min && !max && !missing) || [min, max].some((v) => v && (!decimal.test(v) || v.replace(/[-.]/g, "").length > 38 || (v.split(".")[1]?.length ?? 0) > 38)) || (min && max && compareDecimal(min, max) >= 0)) {
      setError("Enter decimal bounds (up to 38 digits), minimum below maximum, or select missing. Scientific notation is not accepted."); return;
    }
    setError("");
    onChange({ field, ranges: min || max ? [{ ...(min ? { min } : {}), ...(max ? { max } : {}) }] : [], missing });
  };
  return <details className="eda-numeric-control">
    <summary>Set a numeric range for {field}</summary>
    <p className="eda-note">Stored type: {dataType}. Lower bound included, upper bound excluded; units are exactly as recorded. Negative values are allowed. Decimal text preserves integer and decimal precision.</p>
    <form key={JSON.stringify(current)} onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm" htmlFor={`${id}-min`}>{field} ≥<Input id={`${id}-min`} name="lower" inputMode="decimal" maxLength={80} defaultValue={current?.ranges.length === 1 ? current.ranges[0]?.min : ""} /></label>
      <label className="text-sm" htmlFor={`${id}-max`}>{field} &lt;<Input id={`${id}-max`} name="upper" inputMode="decimal" maxLength={80} defaultValue={current?.ranges.length === 1 ? current.ranges[0]?.max : ""} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missing" defaultChecked={current?.missing} /> Include missing / nonfinite {field}</label>
      <Button size="sm" type="submit">Apply numeric range</Button>
      {current && <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>Clear {field} range</Button>}
    </form>
    {current && <p className="eda-note">Current: {numericLabel(current)}. Applying replaces this field’s numeric ranges only.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </details>;
}
function HierarchyTree({ hierarchy, branches, onToggle }: { hierarchy: EDAHierarchy; branches: EDAJointPredicate[]; onToggle: (branch: EDAJointPredicate) => void }) {
  const render = (cells: EDAHierarchy["cells"], depth: number): ReactNode => {
    const groups = new Map<string, EDAHierarchy["cells"]>();
    for (const cell of cells) groups.set(cell.keys[depth]!, [...(groups.get(cell.keys[depth]!) ?? []), cell]);
    return <ul className="eda-hierarchy-level">{[...groups].map(([key, rows]) => {
      const total = rows.reduce((n, r) => n + r.total, 0), selected = rows.reduce((n, r) => n + r.selected, 0);
      const label = `${rows[0]!.labels[depth]} · ${fmtInt(selected)} / ${fmtInt(total)} cases`;
      if (depth < 2) return <li key={key}><details><summary>{hierarchy.fields[depth]}: {label}</summary>{render(rows, depth + 1)}</details></li>;
      const row = rows[0]!;
      const existing = branches.find((b) => matchesContextPath(b, hierarchy.fields, row.keys, row.labels));
      const branch = existing ?? contextPath(hierarchy.fields, row.keys, row.labels);
      const active = Boolean(existing);
      return <li key={key}><button className="eda-value-option" aria-pressed={active} disabled={!active && branches.length >= 24} onClick={() => onToggle(branch)}>{hierarchy.fields[depth]}: {label}<span>{active ? "Selected" : "Add path"}</span></button></li>;
    })}</ul>;
  };
  return <div aria-label="Three-level context hierarchy">{render(hierarchy.cells, 0)}</div>;
}

export function ContextHierarchy({ scope, attributes, branches, onToggle }: {
  scope: ExplorerScope; attributes: string[]; branches: EDAJointPredicate[]; onToggle: (branch: EDAJointPredicate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[]>(attributes.slice(0, 3));
  const [declared, setDeclared] = useState<string[]>();
  const [icicle, setIcicle] = useState(false);
  const query = useQuery({ ...edaQuery(scope.projectId, scope.caseTableId, { ...explorerParams(scope), hierarchyFields: declared }), enabled: open && Boolean(declared) });
  if (attributes.length < 3) return <p className="eda-note">A three-level context view needs three prepared scalar attributes.</p>;
  return <section className="eda-cell" aria-label="Declare a context hierarchy">
    <h3>How do three contexts fit together?</h3>
    <p className="eda-caption">Declare the order you want to inspect. These are nested case groups; the order does not establish a business hierarchy.</p>
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>Declare three levels</Button>
    {open && <div className="mt-4 space-y-4">
      <form className="eda-context-controls" onSubmit={(e) => { e.preventDefault(); setDeclared([...fields]); }}>
        {[0, 1, 2].map((index) => <label key={index}>Context level {index + 1}<select value={fields[index]} onChange={(e) => setFields(fields.map((f, i) => i === index ? e.target.value : f))}>{attributes.map((f) => <option key={f} disabled={fields.some((other, i) => i !== index && other === f)}>{f}</option>)}</select></label>)}
        <Button type="submit" disabled={new Set(fields).size !== 3}>Build hierarchy</Button>
      </form>
      <p className="eda-note">Each case appears in exactly one leaf. Top 20 values, Other and missing stay fixed within each level. Select multiple paths to join whole conjunctions with OR; unrelated filters still intersect. Up to 24 paths.</p>
      {declared && query.isPending && <LoadingBlock />}
      {query.isError && <ErrorBlock error={query.error} retry={() => void query.refetch()} />}
      {!query.isError && query.data?.hierarchy && <>
        <Button size="sm" variant="outline" aria-expanded={icicle} onClick={() => setIcicle(!icicle)}>{icicle ? "Hide" : "Show"} icicle overview</Button>
        {icicle && <ContextIcicle data={query.data.hierarchy} branches={branches} onToggle={onToggle} />}
        <HierarchyTree hierarchy={query.data.hierarchy} branches={branches} onToggle={onToggle} />
      </>}
    </div>}
  </section>;
}
