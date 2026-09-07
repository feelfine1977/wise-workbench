import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Readiness, ReadinessItem } from "@wise/api-schema";
import { useTrackJob } from "@/app/shell/JobTray";
import { decisionKindsQuery, decisionsQuery, useApplyDecision, usePreviewDecision, type Decision, type DecisionKind, type DecisionPreviewNumbers, type DecisionPreviewOut } from "@/lib/api/cycle2";
import { GateBadge } from "@/components/badges";
import { ErrorBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtInt, fmtShare } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The choices a reader makes per decision kind (the contract's `params` of `GET /decisions/kinds`). */
const CHOICES: Record<string, { param: string; options: { id: string; label: string }[] }> = {
  open_cases: {
    param: "handling",
    options: [
      { id: "censor", label: "Censor: ignore the missing closures (lags without an end are not counted as late)" },
      { id: "exclude", label: "Exclude the open cases from the case table" },
      { id: "keep", label: "Keep them as they are and count the missing closure" },
    ],
  },
  zero_exposure: {
    param: "handling",
    options: [
      { id: "exclude", label: "Exclude them from value-weighted priorities" },
      { id: "keep", label: "Keep them with their value of 0" },
    ],
  },
};

/** Plain labels for the kinds, by the readiness item they answer. */
const PLAIN_LABEL: Record<string, string> = {
  drop_outside_window: "Drop the events outside the window",
  sentinel_as_missing: "Treat placeholder dates as missing",
  collapse_duplicates: "Collapse exact duplicates",
  day_precision: "Mark day-precise activities",
  header_events: "Type the header events away",
  open_cases: "Decide how open cases count",
  zero_exposure: "Decide how items without a value count",
  flow_type_assignment: "Assign the flow types",
};

/** One row of the activity list a decision asks about, with what the readiness report knows about it. */
interface ActivityRow {
  activity: string;
  /** True for the activities the item is actually about (day-precision timestamps, header events). */
  concerned: boolean;
  note?: string;
}

function activitiesOf(item: ReadinessItem, kind: DecisionKind): ActivityRow[] {
  const ev = item.evidence ?? {};
  if (kind.kind === "day_precision") {
    const rows = (ev.activities as { activity: string; precision?: string; events?: number; dayShare?: number }[] | undefined) ?? [];
    return rows.map((a) => ({
      activity: a.activity,
      concerned: a.precision === "day",
      note: [a.precision ? `${a.precision} precision` : "", a.events !== undefined ? `${fmtInt(a.events)} events` : ""].filter(Boolean).join(" · "),
    }));
  }
  if (kind.kind === "header_events") return ((ev.headerEvents as string[] | undefined) ?? []).map((a) => ({ activity: a, concerned: true }));
  return [];
}

function defaultParams(item: ReadinessItem, kind: DecisionKind, choice: string, activities: string[]): Record<string, unknown> {
  const ev = item.evidence ?? {};
  switch (kind.kind) {
    case "day_precision":
    case "header_events":
      return { activities };
    case "sentinel_as_missing":
      return { timestamps: ((ev.values as { timestamp: string }[] | undefined) ?? []).map((v) => v.timestamp) };
    case "drop_outside_window":
      return {};
    case "flow_type_assignment":
      return { rules: (ev.rules as unknown[] | undefined) ?? [{ name: "DF1", rule: { attr: "case Item Category", eq: "3-way match, invoice after GR" } }, { name: "DF2", rule: { attr: "case Item Category", eq: "3-way match, invoice before GR" } }, { name: "2-way", rule: { attr: "case Item Category", eq: "2-way match" } }, { name: "Consignment", rule: { attr: "case Item Category", eq: "Consignment" } }], default: "other" };
    default: {
      const c = CHOICES[kind.kind];
      return c ? { [c.param]: choice } : {};
    }
  }
}

function DecisionDialog({
  item,
  kind,
  projectId,
  caseTableId,
  current,
  history,
  open,
  onClose,
  onApplied,
}: {
  item: ReadinessItem;
  kind: DecisionKind;
  projectId: string;
  caseTableId: string;
  /** The decision in force for this item, when one was taken: its options stay open (R3-O1). */
  current?: Decision;
  history: Decision[];
  open: boolean;
  onClose: () => void;
  onApplied: (caseTableId: string, jobId: string) => void;
}) {
  const choices = CHOICES[kind.kind];
  const rows = activitiesOf(item, kind);
  const concerned = rows.filter((r) => r.concerned);
  const currentChoice = (current?.params as Record<string, unknown> | undefined)?.[choices?.param ?? ""];
  const [choice, setChoice] = useState(typeof currentChoice === "string" ? currentChoice : (choices?.options[0]?.id ?? ""));
  const [chosenActivities, setChosenActivities] = useState<string[]>(
    ((current?.params as { activities?: string[] } | undefined)?.activities ?? (concerned.length ? concerned : rows).map((r) => r.activity)),
  );
  const [showAll, setShowAll] = useState(concerned.length === 0);
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState("");
  const [preview, setPreview] = useState<DecisionPreviewOut>();
  const previewMutation = usePreviewDecision(projectId, caseTableId);
  const apply = useApplyDecision(projectId, caseTableId);
  const params = defaultParams(item, kind, choice, chosenActivities);
  const numbers = preview?.preview as DecisionPreviewNumbers | undefined;
  const listed = showAll ? rows : concerned;
  // The mapping may already type every case: the server says so and refuses the change, so the dialog says
  // it first and offers no apply that would be refused (R3-O4, 14).
  const detail = (numbers?.detail ?? {}) as { alreadyTyped?: boolean; message?: string; counts?: Record<string, number>; typedCases?: number };
  const alreadyTyped = kind.kind === "flow_type_assignment" && detail.alreadyTyped === true;

  const runPreview = useCallback(() => previewMutation.mutate({ kind: kind.kind, params }, { onSuccess: setPreview }), [previewMutation, kind.kind, params]);
  // the flow types are the one decision whose answer may be "nothing would change": ask at once, so the
  // dialog opens with the sentence rather than with an apply the server will refuse
  const asked = useRef(false);
  useEffect(() => {
    if (kind.kind !== "flow_type_assignment" || asked.current) return;
    asked.current = true;
    runPreview();
  }, [kind.kind, runPreview]);
  const submit = () =>
    apply.mutate(
      { kind: kind.kind, params, note: note.trim(), author: author.trim() || null },
      {
        onSuccess: (applied) => {
          onApplied(applied.caseTable.id, applied.job.id);
          onClose();
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-full max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{PLAIN_LABEL[kind.kind] ?? kind.label}</DialogTitle>
          <DialogDescription>{item.message}</DialogDescription>
        </DialogHeader>
        {current && (
          <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm" data-testid="decision-current">
            Decided already in version {current.version}
            {typeof currentChoice === "string" ? ` as "${choices?.options.find((o) => o.id === currentChoice)?.label ?? currentChoice}"` : ""}
            {current.note ? ` — ${current.note}` : ""}. Every option stays open: changing it creates a new version and rebuilds the case table.
            {history.length > 1 ? ` This item has been decided ${history.length} times.` : ""}
          </p>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (preview && note.trim() && !alreadyTyped) submit();
          }}
        >
          {choices && (
            <Field label="choice" htmlFor="decision-choice">
              <Select
                value={choice}
                onValueChange={(v) => {
                  setChoice(v);
                  setPreview(undefined);
                }}
              >
                <SelectTrigger id="decision-choice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                      {currentChoice === c.id ? " · current" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {rows.length > 0 && (
            <fieldset data-testid="decision-activities">
              <legend className="text-xs font-medium text-text-muted">
                {kind.kind === "day_precision" ? `activities measured to the day (${concerned.length} of ${rows.length})` : "header events, counted once per order"}
              </legend>
              <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border p-2">
                <ul className="flex flex-col gap-1">
                  {listed.map((r) => (
                    <li key={r.activity} className="flex items-center gap-2 text-sm">
                      <input
                        id={`act-${r.activity}`}
                        type="checkbox"
                        checked={chosenActivities.includes(r.activity)}
                        onChange={(e) => {
                          setChosenActivities((list) => (e.target.checked ? [...list, r.activity] : list.filter((x) => x !== r.activity)));
                          setPreview(undefined);
                        }}
                      />
                      <label htmlFor={`act-${r.activity}`} className="min-w-0 flex-1">
                        {r.activity}
                        {r.note ? <span className="ml-2 text-xs text-text-subtle">{r.note}</span> : null}
                      </label>
                    </li>
                  ))}
                  {listed.length === 0 && <li className="text-sm text-text-muted">No activity of this log is measured to the day.</li>}
                </ul>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-text-muted">{chosenActivities.length} chosen</span>
                <button type="button" className="text-accent-text underline" onClick={() => setChosenActivities(listed.map((r) => r.activity))}>
                  select all
                </button>
                <button type="button" className="text-accent-text underline" onClick={() => setChosenActivities([])}>
                  none
                </button>
                {concerned.length > 0 && concerned.length < rows.length && (
                  <button type="button" className="text-accent-text underline" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "only the day-precise ones" : `show every activity (${rows.length})`}
                  </button>
                )}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={runPreview} disabled={previewMutation.isPending}>
              {previewMutation.isPending ? "Previewing…" : "Preview the effect"}
            </Button>
            {numbers && (
              <span className="tnum text-sm" data-testid="decision-preview">
                <strong>{fmtInt(numbers.cases)}</strong> of {fmtInt(numbers.totalCases)} cases · <strong>{fmtInt(numbers.events)}</strong> of {fmtInt(numbers.totalEvents)} events affected
              </span>
            )}
          </div>
          {alreadyTyped && (
            <p className="rounded-md border border-warning/50 bg-warning-subtle px-3 py-2 text-sm text-warning" data-testid="decision-already-typed">
              {detail.message ?? "The mapping already types these cases. Nothing would change."}
            </p>
          )}
          {!alreadyTyped && detail.message && kind.kind === "flow_type_assignment" && (
            <p className="reading text-sm text-text-muted" data-testid="decision-effect">
              {detail.message}
            </p>
          )}
          {previewMutation.isError && <ErrorBlock error={previewMutation.error} />}
          <Field label="note *" htmlFor="decision-note" hint="Why this decision; who agreed. It travels with the case table as a versioned mapping decision.">
            <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line" />
          </Field>
          <Field label="author" htmlFor="decision-author">
            <Input id="decision-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="name or role" />
          </Field>
          {apply.isError && <ErrorBlock error={apply.error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!preview || !note.trim() || apply.isPending || alreadyTyped} title={alreadyTyped ? "Nothing would change: choose a different set of rules first" : undefined}>
              {apply.isPending ? "Applying…" : "Apply and rebuild the case table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The readiness report with a decision on every item that allows one (R2-O1): a button, a preview of the cases
 * and events affected, a note, then the backend stores it as a versioned mapping decision and rebuilds the
 * case table (a job); the new table's readiness report is the re-evaluation. Decisions taken are listed with
 * author and note.
 */
/**
 * The readiness report as a list of decisions (R3-19).
 *
 * The report is the machine's own log: sixteen lines in the order the checks ran, every one of them a
 * sentence with ISO stamps, `value(s)` and the raw evidence in brackets, and a reader had to read all of them
 * to find the one that mattered. The list below is ordered by what a reader has to do — what is still
 * undecided first, worst first by the share of items it touches — the decided ones become ✓ lines with
 * *Change*, and the machine's own sentence is kept behind *the exact reading*.
 */

/** The share of items a readiness item touches, for the order; the ones with no share sort by their level. */
export function readinessShare(item: ReadinessItem, cases: number | undefined): number {
  const ev = (item.evidence ?? {}) as { share?: number; replicatedShare?: number; cases?: number; casesShare?: number; casesFlagged?: number };
  if (typeof ev.share === "number") return ev.share;
  if (typeof ev.replicatedShare === "number") return ev.replicatedShare;
  if (typeof ev.casesShare === "number") return ev.casesShare;
  if (typeof ev.cases === "number" && cases) return ev.cases / cases;
  if (typeof ev.casesFlagged === "number" && cases) return ev.casesFlagged / cases;
  return 0;
}

/**
 * The item's sentence in the reader's words: the machine's stamps, its `value(s)` and the bracketed evidence
 * taken out. The full sentence stays one click away, so nothing is hidden — only moved off the first read.
 */
export function plainReadiness(message: string): string {
  return message
    // "(earliest 1948-01-26 23:59:00, latest 2020-04-09 23:59:00)" and every other bracketed reading
    .replace(/\s*\([^()]*\d{4}-\d{2}-\d{2}[^()]*\)/g, "")
    .replace(/\s*\((?:robust quantiles|same case, activity and timestamp)\)/g, "")
    // a bare ISO stamp left in the prose
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b/g, (m) => m.slice(0, 10))
    .replace(/\bvalue\(s\)/g, "values")
    .replace(/;\s*most frequent:[^.]*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function ReadinessDecisions({ readiness, projectId, caseTableId, onRebuilt, className }: { readiness: Readiness | null | undefined; projectId: string; caseTableId: string; onRebuilt: (caseTableId: string) => void; className?: string }) {
  const [openItem, setOpenItem] = useState<{ item: ReadinessItem; kind: DecisionKind }>();
  const kinds = useQuery(decisionKindsQuery(projectId));
  // every decision of the project, not only the ones of this case table: decisions accumulate on one
  // lineage, so the list must show them all and "decide again" must know the one in force (R3-O1, R3-O3)
  const decisions = useQuery(decisionsQuery(projectId));
  const track = useTrackJob(projectId);
  const items = readiness?.items ?? [];
  const kindOf = (item: ReadinessItem): DecisionKind | undefined => {
    const own = item.decision as { kind?: string; label?: string; params?: string[] } | null | undefined;
    if (own?.kind) return { kind: own.kind, item: item.id, params: own.params ?? [], label: own.label ?? own.kind };
    return (kinds.data ?? []).find((k) => k.item === item.id);
  };
  const applied = [...(decisions.data ?? [])].sort((a, b) => a.version - b.version);
  const decided = new Set(applied.map((d) => d.kind));
  const historyOf = (kindId: string) => applied.filter((d) => d.kind === kindId);
  const currentOf = (kindId: string) => historyOf(kindId)[historyOf(kindId).length - 1];
  const cases = (readiness?.items ?? []).find((i) => i.id === "volume")?.evidence?.cases as number | undefined;
  const caseNoun = readiness?.caseNoun ?? "cases";
  const isDone = (it: ReadinessItem) => {
    const k = kindOf(it);
    return !!k && decided.has(k.kind);
  };
  // undecided first, the one that touches the most items first; the decided ones follow in the same order
  const ordered = [...items].sort((a, b) => {
    const da = isDone(a) ? 1 : 0;
    const db = isDone(b) ? 1 : 0;
    if (da !== db) return da - db;
    const la = a.level === "fail" ? 2 : a.level === "warn" ? 1 : 0;
    const lb = b.level === "fail" ? 2 : b.level === "warn" ? 1 : 0;
    if (la !== lb) return lb - la;
    return readinessShare(b, cases) - readinessShare(a, cases);
  });
  const undecided = ordered.filter((it) => !isDone(it) && !!kindOf(it));
  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="readiness-decisions">
      <Card>
        <CardTitle>What could distort the results, and what you decide about it</CardTitle>
        <p className="reading mb-2 text-sm text-text-muted">
          {undecided.length === 0
            ? "Everything this report raises has been decided. The lines below say what was decided and let you change it."
            : `${fmtInt(undecided.length)} ${undecided.length === 1 ? "reading is" : "readings are"} still open, the one that touches the most ${caseNoun} first.`}
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {ordered.map((it) => {
            const kind = kindOf(it);
            const done = kind ? decided.has(kind.kind) : false;
            const share = readinessShare(it, readiness ? cases : undefined);
            const plain = plainReadiness(it.message);
            return (
              <li key={it.id} className="flex flex-wrap items-start gap-3 py-3" data-readiness-item={it.id} data-decided={done ? "1" : undefined}>
                {done ? (
                  <span aria-label="decided" className="mt-0.5 text-success" data-testid={`decided-${it.id}`}>
                    ✓
                  </span>
                ) : (
                  <GateBadge state={it.level === "fail" ? "failed" : it.level === "warn" ? "pending" : "passed"} label={it.level} className="mt-0.5" />
                )}
                <span className="min-w-0 flex-1 text-sm">
                  <span className="reading block">{plain}</span>
                  {share > 0 && !done && (
                    <span className="text-xs text-text-subtle">
                      touches {fmtShare(share)} of the {caseNoun}
                    </span>
                  )}
                  {plain !== it.message && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-xs text-text-subtle">the exact reading</summary>
                      <span className="reading block text-xs text-text-muted">{it.message}</span>
                    </details>
                  )}
                </span>
                {kind && (
                  <span className="flex flex-col items-end gap-0.5">
                    <Button size="sm" variant="outline" onClick={() => setOpenItem({ item: it, kind })} aria-label={`${done ? "Change" : PLAIN_LABEL[kind.kind] ?? kind.label}: ${it.id}`}>
                      {done ? "Change" : (PLAIN_LABEL[kind.kind] ?? kind.label)}
                    </Button>
                    {done && (
                      <span className="text-[11px] text-text-subtle" data-testid={`decision-state-${kind.kind}`}>
                        {PLAIN_LABEL[kind.kind] ?? kind.label} · decided {historyOf(kind.kind).length === 1 ? "once" : `${historyOf(kind.kind).length} times`}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardTitle>Decisions taken</CardTitle>
        {decisions.isError && <ErrorBlock error={decisions.error} />}
        {applied.length === 0 ? (
          <p className="text-sm text-text-muted">No decision yet. Each decision is a versioned mapping decision: it names its author, keeps its note and rebuilds the case table so the readiness report is re-evaluated. Decisions accumulate: a new one starts from the case table the last one produced, and every item keeps its full set of options.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" data-testid="decisions-list">
            {applied.map((d) => {
              const n = d.preview as unknown as Partial<DecisionPreviewNumbers>;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <strong>{PLAIN_LABEL[d.kind] ?? d.kind}</strong>
                  <span className="text-xs text-text-subtle">v{d.version}</span>
                  {currentOf(d.kind)?.id === d.id ? <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">in force</span> : <span className="text-[11px] text-text-subtle">replaced</span>}
                  <span className="tnum text-text-muted">
                    {fmtInt(n.cases)} cases · {fmtInt(n.events)} events
                  </span>
                  <span className="text-text-muted">{d.author ?? "–"}</span>
                  <span className="text-text-muted">{d.note}</span>
                  <span className="font-mono text-xs text-text-subtle">{d.resultCaseTableId}</span>
                  <span className="ml-auto text-xs text-text-subtle">{fmtDateTime(d.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {openItem && (
        <DecisionDialog
          item={openItem.item}
          kind={openItem.kind}
          projectId={projectId}
          caseTableId={caseTableId}
          current={currentOf(openItem.kind.kind)}
          history={historyOf(openItem.kind.kind)}
          open
          onClose={() => setOpenItem(undefined)}
          onApplied={(nextCaseTable, jobId) => {
            track({ id: jobId, kind: "build_cases", status: "queued", progress: 0, attempts: 0, cancelRequested: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, `Rebuild the case table (${(PLAIN_LABEL[openItem.kind.kind] ?? openItem.kind.label).toLowerCase()})`);
            onRebuilt(nextCaseTable);
          }}
        />
      )}
    </div>
  );
}
