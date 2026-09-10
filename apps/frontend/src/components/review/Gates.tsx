/**
 * Checks before acting (R3-03): the gates of one group with their evidence, their plain sentence and
 * *pass · fail · waive* with a mandatory note and an author, and the hypothesis a reader writes from a
 * reason — which cannot be saved while a gate **this group itself fails** is undecided.
 *
 * A gate that reads the same on every group of the log (the case table's readiness report) is not a gate of
 * the group: it is stated once, at the run, with the way to the readiness list, and it never asks for
 * fifty-seven identical waivers (§1.8).
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { blockingGates, gatesQuery, isRunWide, reviewQuery, useCreateReviewItem, useDecideGate, type Gate, type ReviewItem } from "@/lib/api/review";
import { notServed } from "@/lib/api/compatibility";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { GateBadge } from "@/components/badges";
import { LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { fmtDateTime, fmtPct, fmtShare } from "@/lib/format";
import { cn } from "@/lib/utils";

const GATE_WORDS: Record<string, string> = {
  readiness: "the data is fit to read",
  censoring: "items still open at the end of the data",
  replication: "duplicated events",
  domain: "the numbers are plausible to the people who know the process",
};

/** The state a badge shows; `pending` is the state the reader is asked to end. */
const badgeState = (g: Gate) => (g.status === "waived" ? "waived" : g.status === "passed" ? "passed" : g.status === "failed" ? "failed" : "pending");

function evidenceWords(gate: Gate): string | undefined {
  const e = (gate.evidence ?? {}) as { share?: number | null; warnAt?: number | null; failAt?: number | null; readinessStatus?: string };
  if (typeof e.share === "number") return `${fmtShare(e.share)} of these items${typeof e.warnAt === "number" ? `, a warning above ${fmtPct(e.warnAt, 0)}` : ""}`;
  if (e.readinessStatus) return `the readiness report of this log reads ${e.readinessStatus}`;
  return undefined;
}

function GateRow({
  gate,
  runWide,
  onDecide,
  pending,
  projectId,
  runId,
}: {
  gate: Gate;
  runWide: boolean;
  onDecide: (input: { gateId: string; status: "passed" | "failed" | "waived"; note: string; author: string }) => void;
  pending: boolean;
  projectId: string;
  runId: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"passed" | "failed" | "waived">("waived");
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState("");
  const decided = gate.status !== "pending" && gate.note;
  const canSave = note.trim().length > 0 && author.trim().length > 0 && !pending;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0" data-testid={`gate-${gate.id}`} data-gate-status={gate.status}>
      <div className="flex flex-wrap items-start gap-2">
        <GateBadge state={badgeState(gate)} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-text">
            {GATE_WORDS[gate.kind] ?? gate.kind}
            <WhatDoesThisMean kind="failure_mode" entryId={gate.kind} label={GATE_WORDS[gate.kind] ?? gate.kind} />
            {runWide && (
              <Badge variant="outline" className="text-[10px]">
                one reading for the whole run
              </Badge>
            )}
          </p>
          <p className="reading text-sm text-text-muted">{gate.text}</p>
          {evidenceWords(gate) && <p className="text-xs text-text-subtle">Evidence: {evidenceWords(gate)}.</p>}
          {decided && (
            <p className="text-xs text-text-muted" data-testid={`gate-note-${gate.id}`}>
              {gate.status} by {gate.author ?? "someone"}
              {gate.decidedAt ? ` on ${fmtDateTime(gate.decidedAt)}` : ""} — “{gate.note}”
            </p>
          )}
        </div>
        {runWide ? (
          <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId }} search={{ tab: "monitor" as const }} className="shrink-0 text-xs text-accent-text underline">
            Read it once at the run →
          </Link>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {gate.status === "pending" ? "Decide" : "Change"}
          </Button>
        )}
      </div>
      {open && !runWide && (
        <form
          className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            onDecide({ gateId: gate.id, status, note: note.trim(), author: author.trim() });
            setOpen(false);
          }}
        >
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">What this check should read</legend>
            {(["passed", "failed", "waived"] as const).map((s) => (
              <label key={s} className={cn("cursor-pointer rounded-full border px-2.5 py-1 text-xs", status === s ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-text-muted")}>
                <input type="radio" className="sr-only" name={`gate-${gate.id}-status`} value={s} checked={status === s} onChange={() => setStatus(s)} />
                {s === "passed" ? "It is fine" : s === "failed" ? "It is not fine" : "Waive it, with a reason"}
              </label>
            ))}
          </fieldset>
          <label className="text-xs text-text-muted" htmlFor={`gate-${gate.id}-note`}>
            Why (required)
          </label>
          <Textarea id={`gate-${gate.id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and what you concluded." />
          <label className="text-xs text-text-muted" htmlFor={`gate-${gate.id}-author`}>
            Who decided (required)
          </label>
          <Input id={`gate-${gate.id}-author`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or role" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!canSave}>
              Record this reading
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {!canSave && (note.trim() || author.trim()) && <p className="text-xs text-warning">A check is only decided with a reason and a name.</p>}
        </form>
      )}
    </li>
  );
}

export interface GatesBlockProps {
  projectId: string;
  runId: string;
  slicing: string;
  sliceKey: string;
  view?: string;
  /** The expectations a hypothesis can be written on, in plain words. */
  constraints?: { id: string; label: string }[];
  /**
   * A reason marked *to test* on *What can we do?*: the expectation it belongs to and its own words, which
   * fill the form. `nonce` changes on every mark, so marking a second reason replaces the first draft.
   */
  draft?: { constraint?: string; statement?: string; nonce: number };
  className?: string;
}

/** Everything the Data trust tab and *What can we do?* share: the gates, the hypothesis form, the records. */
export function GatesBlock({ projectId, runId, slicing, sliceKey, view, constraints, draft, className }: GatesBlockProps) {
  const gates = useQuery({ ...gatesQuery(projectId, runId, { slicing, sliceKey, view }), enabled: !!slicing && !!sliceKey });
  const decide = useDecideGate(projectId, runId, { slicing, sliceKey, view });
  const list = gates.data?.gates ?? [];
  const blocking = blockingGates(list);

  if (gates.isPending) return <LoadingBlock rows={4} className={className} />;
  if (gates.isError) {
    return (
      <p className={cn("reading text-sm text-text-muted", className)} data-testid="gates-unavailable">
        {notServed(gates.error)
          ? "This backend does not compute the checks before acting for one group yet, so nothing is blocked here. The data caveats above are what is known."
          : "The checks could not be read just now. The data caveats above are what is known."}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div>
        <p className="reading text-sm text-text-muted">
          {blocking.length === 0
            ? "Every check that applies to this group has a reading. A hypothesis can be recorded."
            : `${blocking.length === 1 ? "One check" : `${blocking.length} checks`} on this group ${blocking.length === 1 ? "has" : "have"} no reading yet. Pass, fail or waive ${blocking.length === 1 ? "it" : "them"} with a note before a hypothesis is recorded.`}
        </p>
        <ul className="mt-1 flex flex-col" data-testid="gate-list">
          {list.map((g) => (
            <GateRow key={g.id} gate={g} runWide={isRunWide(g)} onDecide={(input) => decide.mutate(input)} pending={decide.isPending} projectId={projectId} runId={runId} />
          ))}
        </ul>
        {decide.isError && <p className="text-xs text-danger">The reading could not be saved on this backend; it stays on the screen only.</p>}
      </div>
      <HypothesisForm
        key={draft?.nonce ?? 0}
        projectId={projectId}
        runId={runId}
        slicing={slicing}
        sliceKey={sliceKey}
        view={view}
        constraints={constraints}
        draft={draft}
        blocking={blocking}
      />
      <HypothesisList projectId={projectId} runId={runId} sliceKey={sliceKey} />
    </div>
  );
}

function HypothesisForm({
  projectId,
  runId,
  slicing,
  sliceKey,
  view,
  constraints,
  draft,
  blocking,
}: {
  projectId: string;
  runId: string;
  slicing: string;
  sliceKey: string;
  view?: string;
  constraints?: { id: string; label: string }[];
  draft?: { constraint?: string; statement?: string; nonce: number };
  blocking: Gate[];
}) {
  const [constraint, setConstraint] = useState(draft?.constraint ?? constraints?.[0]?.id ?? "");
  const [statement, setStatement] = useState(draft?.statement ?? "");
  const [direction, setDirection] = useState<"higher" | "lower">("higher");
  const [author, setAuthor] = useState("");
  const create = useCreateReviewItem(projectId, "hypotheses");
  const blocked = blocking.length > 0;
  const canSave = !blocked && constraint.length > 0 && statement.trim().length > 0 && author.trim().length > 0 && !create.isPending;

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      data-testid="hypothesis-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        create.mutate(
          {
            runId,
            slicing,
            sliceKey,
            view,
            constraint_id: constraint,
            comparison: "group_vs_rest",
            expected_direction: direction,
            statement_plain: statement.trim(),
            author: author.trim(),
            title: statement.trim().slice(0, 120),
          },
          { onSuccess: () => setStatement("") },
        );
      }}
    >
      <h4 className="text-sm font-semibold text-text">Record a hypothesis to test</h4>
      {blocked && (
        <p className="reading rounded-md border border-warning/40 bg-warning-subtle p-2 text-sm text-text" role="status" data-testid="hypothesis-blocked">
          Not yet: {blocking.map((g) => GATE_WORDS[g.kind] ?? g.kind).join(" and ")} {blocking.length === 1 ? "has" : "have"} no reading on this group. A hypothesis rests on numbers that can be trusted, so decide the
          {blocking.length === 1 ? " check" : " checks"} above first — waiving with a note counts.
        </p>
      )}
      <label className="text-xs text-text-muted" htmlFor="hypothesis-constraint">
        About which expectation
      </label>
      <select
        id="hypothesis-constraint"
        className="h-control rounded border border-border bg-surface px-2 text-sm"
        value={constraint}
        onChange={(e) => setConstraint(e.target.value)}
        disabled={blocked}
      >
        {(constraints ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label className="text-xs text-text-muted" htmlFor="hypothesis-statement">
        What you think is going on, in your own words
      </label>
      <Textarea id="hypothesis-statement" value={statement} onChange={(e) => setStatement(e.target.value)} disabled={blocked} placeholder="These items wait longer because the confirmation is entered by hand." />
      <fieldset className="flex flex-wrap items-center gap-2 text-xs">
        <legend className="sr-only">What you expect to see</legend>
        <span className="text-text-muted">You expect this group to be</span>
        {(["higher", "lower"] as const).map((d) => (
          <label key={d} className={cn("cursor-pointer rounded-full border px-2.5 py-1", direction === d ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-text-muted")}>
            <input type="radio" className="sr-only" name="hypothesis-direction" value={d} checked={direction === d} onChange={() => setDirection(d)} disabled={blocked} />
            {d === "higher" ? "worse than everyone else" : "better than everyone else"}
          </label>
        ))}
      </fieldset>
      <label className="text-xs text-text-muted" htmlFor="hypothesis-author">
        Who is recording it
      </label>
      <Input id="hypothesis-author" value={author} onChange={(e) => setAuthor(e.target.value)} disabled={blocked} placeholder="Your name or role" />
      <div>
        <Button type="submit" size="sm" disabled={!canSave}>
          {create.isPending ? "Saving…" : "Record the hypothesis"}
        </Button>
      </div>
      {create.isError && <p className="text-xs text-danger">The hypothesis could not be saved on this backend; nothing was recorded.</p>}
    </form>
  );
}

function HypothesisList({ projectId, runId, sliceKey }: { projectId: string; runId: string; sliceKey: string }) {
  const items = useQuery(reviewQuery(projectId, "hypotheses", { runId }));
  const rows = (items.data ?? []).filter((h: ReviewItem) => !h.sliceKey || h.sliceKey === sliceKey);
  if (items.isError || rows.length === 0) return null;
  return (
    <section data-testid="hypothesis-list">
      <h4 className="mb-1 text-sm font-semibold text-text">Hypotheses on this group</h4>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((h) => (
          <li key={h.id} className="rounded-md border border-border p-2">
            <p className="reading text-text">{h.title || (h as { statement_plain?: string }).statement_plain || "A hypothesis"}</p>
            <p className="text-xs text-text-muted">
              {h.status} · {h.author ?? "unnamed"} · {fmtDateTime(h.createdAt)}
              {typeof (h as { risk_difference?: number }).risk_difference === "number" ? ` · risk difference ${(h as { risk_difference?: number }).risk_difference?.toFixed(3)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
