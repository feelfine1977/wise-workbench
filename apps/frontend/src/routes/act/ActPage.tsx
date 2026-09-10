/**
 * *What can we do?* — the seventh step of the analysis path (R3-01, RG-4, RK-7).
 *
 * For the group's top expectations the server already answers, in 1.7 s: the expectation in plain words,
 * the share of the shortfall, the headroom in score points, the comparison sentence, *what to check first*,
 * the usual reasons split *in the log: check …* / *outside the log: ask …* and the usual actions with a
 * countermeasure type and an owner role — all of it drawn from the hub pages, so the words here are the
 * words the *What does this mean?* chip opens.
 *
 * The reader marks a reason **to test**, which writes a hypothesis (blocked by a gate this group itself
 * fails), and proposes an action; both are saved on the server with an author and a note and list under
 * *Open findings*.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWorkbench } from "@/app/context";
import { actRoute } from "@/app/router";
import { stringifySearch } from "@/app/search";
import type { RunWithScope as RunC2 } from "@/lib/api/runs";
import { reviewQuery, useCreateReviewItem, type Driver, type ReviewItem, type WhatCanWeDo } from "@/lib/api/review";
import { notServed } from "@/lib/api/compatibility";
import type { UsualAction, UsualReason } from "@/lib/api/knowledge";
import { whatCanWeDoQuery } from "@/lib/api/review";
import { measureWords, roleWords } from "@/components/knowledge/words";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { GatesBlock } from "@/components/review/Gates";
import { BackControl } from "@/components/guide/BackControl";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/misc";
import { fmtDateTime, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { backlogQuery } from "@/lib/api/exploration";
import { ApiError } from "@/lib/api";
import { groupLabel, sharedKeyValues } from "@/lib/sentences";
import { cn } from "@/lib/utils";

const COUNTERMEASURES = ["policy", "system_setting", "standard_work", "training", "catalogue", "contract", "master_data", "automation", "review", "measurement"] as const;

/** One driver: the expectation, what it costs, what usually causes it and what usually helps. */
function DriverCard({
  driver,
  rank,
  noun,
  onTest,
  onPropose,
  form,
}: {
  driver: Driver;
  rank: number;
  noun: string;
  onTest?: (driver: Driver, reason: UsualReason) => void;
  onPropose: (driver: Driver, action: UsualAction) => void;
  /** The proposal form, when it was opened from one of this driver's actions: it belongs where it was asked for. */
  form?: React.ReactNode;
}) {
  const name = driver.plain_name ?? driver.constraint_id;
  return (
    <Card data-testid="driver-card" data-constraint={driver.constraint_id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="mb-0 flex flex-wrap items-center gap-1.5 text-lg">
          <span className="text-text-subtle">{rank}.</span>
          {name}
          <WhatDoesThisMean nodeId={driver.hub_node} kind="constraint" entryId={driver.constraint_id} label={name} />
        </CardTitle>
        {driver.headroom_points !== null && driver.headroom_points !== undefined && (
          <Badge variant="outline" className="tnum shrink-0" data-testid="headroom">
            {fmtNum(driver.headroom_points, 2)} points of possible gain
            {driver.headroom_percent !== null && driver.headroom_percent !== undefined ? ` (${fmtNum(driver.headroom_percent, 0)} %)` : ""}
          </Badge>
        )}
      </div>
      <p className="reading mt-2 text-base text-text" data-testid="driver-reading">
        {driver.share_of_shortfall !== null && driver.share_of_shortfall !== undefined ? (
          <>
            This one expectation is <strong className="tnum">{fmtPct(Math.min(driver.share_of_shortfall, 9.99), 0)}</strong> of the shortfall of this group.{" "}
          </>
        ) : null}
        {driver.meaning_when_missed}
      </p>
      {driver.comparison && (
        // one comparison, one bracket, on every screen it appears (R3-04): the server keeps the bracket in
        // agreement with the two numbers beside it, here as everywhere, and the screen prints what it is given
        <p className="reading mt-1 text-sm text-text-muted" data-testid="driver-comparison">
          {driver.comparison.replace(/\.+$/, "")}.
        </p>
      )}
      {driver.why_it_matters && <p className="reading mt-1 text-sm text-text-muted">{driver.why_it_matters}</p>}

      {driver.what_to_check_first?.length ? (
        <section className="mt-4">
          <h4 className="text-sm font-semibold text-text">What to check first</h4>
          <ol className="mt-1 flex list-inside list-decimal flex-col gap-1 text-sm text-text">
            {driver.what_to_check_first.map((c) => (
              <li key={c} className="reading">
                {c}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section>
          <h4 className="text-sm font-semibold text-text">What usually causes it</h4>
          <p className="text-xs text-text-subtle">Candidates to check, not findings. {onTest ? "Mark one to test and it becomes a hypothesis with its gates." : "Hypothesis creation uses whole-group checks and is unavailable in this selection."}</p>
          <ul className="mt-2 flex flex-col gap-2.5 text-sm" data-testid="driver-reasons">
            {(driver.usual_reasons ?? []).map((r, i) => {
              const outside = r.where === "outside";
              return (
                <li key={`${r.text}-${i}`} className="flex flex-col gap-1">
                  <span className="reading text-text">{r.text}</span>
                  <span className="text-xs text-text-muted">
                    <span className={cn("mr-1 rounded-sm px-1 py-0.5 text-[11px]", outside ? "bg-warning-subtle text-warning" : "bg-surface-sunken text-text-muted")}>{outside ? "outside the log — ask" : "in the log — check"}</span>
                    {r.check ?? (outside ? "the people who run the step" : `the events of these ${noun}`)}
                  </span>
                  {onTest && <span>
                    <Button variant="outline" size="sm" onClick={() => onTest(driver, r)}>
                      Mark to test
                    </Button>
                  </span>}
                </li>
              );
            })}
            {!(driver.usual_reasons ?? []).length && <li className="text-text-muted">The pack carries no candidate causes for this expectation yet.</li>}
          </ul>
        </section>
        <section data-testid="driver-help">
          <h4 className="text-sm font-semibold text-text">What usually helps</h4>
          <p className="text-xs text-text-subtle">Each with the kind of countermeasure and the role that usually owns it.</p>
          <ul className="mt-2 flex flex-col gap-2.5 text-sm" data-testid="driver-actions">
            {(driver.usual_actions ?? []).map((a, i) => (
              <li key={`${a.text}-${i}`} className="flex flex-col gap-1">
                <span className="reading text-text">{a.text}</span>
                <span className="text-xs text-text-muted" data-testid="action-owner">
                  {[measureWords(a.countermeasure), roleWords(a.owner_role)].filter(Boolean).join(" · ") || "no owner role in the pack"}
                </span>
                <span>
                  <Button variant="outline" size="sm" onClick={() => onPropose(driver, a)}>
                    Propose this action
                  </Button>
                </span>
              </li>
            ))}
            {!(driver.usual_actions ?? []).length && <li className="text-text-muted">The pack carries no actions for this expectation yet.</li>}
          </ul>
          {/* the form opens under the option that was pressed, not at the foot of the page (P1-7) */}
          {form ? <div className="mt-3">{form}</div> : null}
        </section>
      </div>
    </Card>
  );
}

/** The form that proposes an action, opened from a *usual action* or empty. */
function ActionForm({
  projectId,
  runId,
  slicing,
  sliceKey,
  view,
  filter,
  within,
  draft,
  onDone,
}: {
  projectId: string;
  runId: string;
  slicing: string;
  sliceKey: string;
  view?: string;
  filter?: string;
  within?: string;
  draft: { title: string; countermeasure?: string | null; owner_role?: string | null; constraint?: string } | undefined;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(draft?.title ?? "");
  const [owner, setOwner] = useState(draft?.owner_role ?? "");
  const [measure, setMeasure] = useState(draft?.countermeasure ?? "review");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const create = useCreateReviewItem(projectId, "actions");
  const first = useRef<HTMLTextAreaElement>(null);
  const refusal = useRef<HTMLParagraphElement>(null);
  // pressing *Propose this action* used to change nothing on the screen: the form was rendered at the foot of
  // the page, 1,952 px below the button. It is now under the option that was pressed, and the reader is put in
  // its first field so that both a pointer and a keyboard arrive in the same place (P1-7).
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    first.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    if (create.isError) refusal.current?.focus();
  }, [create.isError, create.error]);
  const canSave = title.trim().length > 0 && owner.trim().length > 0 && author.trim().length > 0 && !create.isPending;
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent-subtle p-3"
      data-testid="action-form"
      aria-labelledby="action-form-title"
      aria-busy={create.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        create.mutate(
          {
            title: title.trim(),
            runId,
            slicing,
            sliceKey,
            view,
            ...(filter !== undefined ? { filter } : {}),
            ...(within !== undefined ? { within } : {}),
            countermeasure: (COUNTERMEASURES as readonly string[]).includes(measure) ? measure : "review",
            owner_role: owner.trim(),
            author: author.trim(),
            note: note.trim() || undefined,
            status: "proposed",
            links: draft?.constraint ? [draft.constraint] : [],
          },
          { onSuccess: onDone },
        );
      }}
    >
      <h4 id="action-form-title" className="text-sm font-semibold text-text">Propose an action</h4>
      <p className="reading text-xs text-text-muted">
        Saving a proposal keeps it for review. Acceptance is a separate decision and requires saved evidence and current checks that have passed or been waived. Pending or failed checks do not prevent saving a proposal.
      </p>
      {filter !== undefined && (
        <p className="reading text-xs text-text-muted">
          The filter in this address is sent for validation. Only supported selections can be measured; unsupported filter variants may be kept in a proposal but cannot be accepted. Acceptance requires checks for that exact selection.
        </p>
      )}
      {within !== undefined && (
        <p className="reading text-xs text-warning">
          This drilled selection includes a parent group. Saving requires support for that exact selection; whole-group evidence cannot replace it.
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        The proposal form is open, under the action you pressed.
      </p>
      <label className="text-xs text-text-muted" htmlFor="action-title">
        What should be done
      </label>
      <Textarea id="action-title" ref={first} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-xs text-text-muted" htmlFor="action-measure">
            What kind of countermeasure
          </label>
          <select id="action-measure" className="h-control w-full rounded border border-border bg-surface px-2 text-sm" value={measure ?? "review"} onChange={(e) => setMeasure(e.target.value)}>
            {COUNTERMEASURES.map((c) => (
              <option key={c} value={c}>
                {measureWords(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted" htmlFor="action-owner">
            Who owns it
          </label>
          <Input id="action-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="a role, not a person" />
        </div>
      </div>
      <label className="text-xs text-text-muted" htmlFor="action-note">
        A note (optional)
      </label>
      <Input id="action-note" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="text-xs text-text-muted" htmlFor="action-author">
        Who is proposing it
      </label>
      <Input id="action-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or role" />
      {create.isError && (
        <p id="action-save-error" ref={refusal} role="alert" tabIndex={-1} className="reading text-sm text-danger">
          {create.error instanceof ApiError
            ? `The proposal could not be saved. ${create.error.problem?.detail?.trim() || "Review the proposal and try again."}`
            : "The save could not be confirmed. Check your connection and review Open findings before retrying."}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canSave} aria-describedby={create.isError ? "action-save-error" : undefined}>
          {create.isPending ? "Saving…" : create.isError ? "Retry saving the proposal" : "Save the proposal"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SavedActionEvidence({ action, noun }: { action: ReviewItem; noun: string }) {
  const context = action.evidenceContext;
  const recorded = action.evidenceState === "recorded" && context && typeof context === "object" && !Array.isArray(context);
  const filter = recorded && "filter" in context ? context.filter : undefined;
  const filtered = filter && typeof filter === "object" && "and" in filter && Array.isArray(filter.and) && filter.and.length > 0;
  const measured = recorded && context.selectionState === "measured" && typeof context.selectionFingerprint === "string" && context.selectionFingerprint.length > 0 && typeof context.populationCases === "number" && Number.isSafeInteger(context.populationCases) && context.populationCases > 0;
  return (
    <p className="text-xs text-text-muted" data-testid="action-evidence">
      {!recorded
        ? "Evidence not assessed. Create a new proposal for the current group before acceptance."
        : filtered
          ? measured
            ? `Evidence scope recorded with a filter. Selected ${noun} measured: ${fmtInt(context.populationCases!)}. Acceptance still requires available, unchanged evidence and current checks that have passed or been waived.`
            : `Evidence scope recorded with a filter. Acceptance is unavailable until checks can be measured for that exact selection.${context.selectionReason ? ` ${context.selectionReason}` : ""}`
          : "Evidence scope recorded. Acceptance still requires available, unchanged evidence and current checks that have passed or been waived."}
    </p>
  );
}

/** Everything recorded on this group so far: hypotheses to test and actions proposed. */
function OpenFindings({ projectId, runId, slicing, sliceKey, noun }: { projectId: string; runId: string; slicing: string; sliceKey: string; noun: string }) {
  const actions = useQuery(reviewQuery(projectId, "actions", { runId, slicing, sliceKey }));
  const hypotheses = useQuery(reviewQuery(projectId, "hypotheses", { runId, slicing, sliceKey }));
  const selectedKey = normalizedGroupKey(sliceKey);
  const mine = (rows: ReviewItem[] | undefined) => (rows ?? []).filter((r) => !r.sliceKey || normalizedGroupKey(r.sliceKey) === selectedKey);
  const a = mine(actions.data);
  const h = mine(hypotheses.data);
  const unavailable = notServed(actions.error) && notServed(hypotheses.error);
  return (
    <Card data-testid="open-findings">
      <CardTitle>Open findings</CardTitle>
      {unavailable && <p className="reading text-sm text-text-muted">This backend does not keep findings and actions yet, so nothing recorded here survives a restart.</p>}
      {!unavailable && a.length === 0 && h.length === 0 && <p className="reading text-sm text-text-muted">Nothing is recorded on this group yet. Mark a reason to test or propose an action above.</p>}
      {h.length > 0 && (
        <>
          <h4 className="mt-2 text-sm font-semibold text-text">To test</h4>
          <ul className="mt-1 flex flex-col gap-1.5 text-sm">
            {h.map((x) => (
              <li key={x.id} className="reading">
                {x.title || "a hypothesis"} <span className="text-xs text-text-muted">· {x.status} · {x.author ?? "unnamed"} · {fmtDateTime(x.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {a.length > 0 && (
        <>
          <h4 className="mt-3 text-sm font-semibold text-text">Actions</h4>
          <ul className="mt-1 flex flex-col gap-1.5 text-sm">
            {a.map((x) => (
              <li key={x.id} className="reading">
                {x.title} <span className="text-xs text-text-muted">· {roleWords((x as { owner_role?: string }).owner_role) ?? "no owner"} · {x.status} · {x.author ?? "unnamed"}</span>
                <SavedActionEvidence action={x} noun={noun} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Saved group keys and URL keys can encode the same values with different JSON spacing. */
function normalizedGroupKey(key: string): string {
  try {
    return JSON.stringify(JSON.parse(key) as unknown);
  } catch {
    return key;
  }
}

export default function ActPage() {
  const ctx = useWorkbench();
  const { runId, sliceKey } = actRoute.useParams();
  const search = actRoute.useSearch();
  const navigate = useNavigate();
  const run = ctx.runs.find((r) => r.id === runId) as RunC2 | undefined;
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? "";
  const view = search.view ?? run?.views?.[0];
  const selected = search.filter !== undefined || search.within !== undefined;
  const [draft, setDraft] = useState<{ title: string; countermeasure?: string | null; owner_role?: string | null; constraint?: string }>();
  const [toTest, setToTest] = useState<{ constraint?: string; statement?: string; nonce: number }>({ constraint: search.constraint, nonce: 0 });

  const answer = useQuery({ ...whatCanWeDoQuery(ctx.projectId, runId, { slicing, sliceKey, view }), enabled: !!run && !!slicing });
  const page1 = useQuery({ ...backlogQuery(ctx.projectId, runId, { slicing, view, minCases: run?.minCases ?? 1, sort: "-stable_PI", page: 1, pageSize: 10 }), enabled: !!run && !!slicing });
  const shared = useMemo(() => sharedKeyValues(page1.data?.rows ?? []), [page1.data]);
  const row = (page1.data?.rows ?? []).find((r) => r.key === sliceKey);
  // a group ranked below the first page has no row here; its name is then read from the key, never printed raw
  const name = groupLabel(row ?? { key: sliceKey }, shared);

  if (!run) {
    return <EmptyState title="This run does not exist in this workspace." reason={`No group can be opened for ${runId}.`} action={{ label: "Go to Runs", to: "/p/$projectId/runs", params: { projectId: ctx.projectId } }} />;
  }

  const data = answer.data as WhatCanWeDo | undefined;
  const drivers = data?.drivers ?? [];
  const noun = data?.caseNoun ?? row?.case_noun ?? "cases";
  const constraints = drivers.map((d) => ({ id: d.constraint_id, label: d.plain_name ?? d.constraint_id }));
  const whyHref = { to: "/p/$projectId/runs/$runId/slices/$sliceKey" as const, params: { projectId: ctx.projectId, runId, sliceKey }, search: { slicing, view, filter: search.filter, within: search.within, tab: "why" as const } };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
          <BackControl fallback={{ href: `/p/${ctx.projectId}/runs/${runId}/slices/${encodeURIComponent(sliceKey)}${stringifySearch(whyHref.search)}`, label: "Why?" }} className="normal-case tracking-normal" />
          <span>What can we do?</span>
        </div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
          {name}
          <HowToReadToggle id="act" />
        </h1>
        {selected && (
          <p role="status" className="reading text-sm text-warning" data-testid="act-selection-notice">
            Suggestions below describe the whole group.{" "}
            {search.filter !== undefined && "Action checks use the exact filter in this address when the selection is supported. Unsupported or empty selections cannot receive a scoped decision. "}
            {search.within !== undefined && "The drilled selection is sent with the proposal request, but saving is refused until its parent group can be recorded."}
          </p>
        )}
        {data?.reading && (
          <p className="reading headline text-text" data-testid="act-reading">
            {selected && <strong>Whole group: </strong>}
            {data.reading}
          </p>
        )}
        <HowToRead id="act">
          The expectations behind this group's shortfall, worst first, each with what it would be worth to close it, what usually causes it — split into what the log can show and what has to be asked — and what usually helps,
          with the kind of countermeasure and the role that owns it. {selected ? "Hypothesis creation is unavailable in this selection. " : <>Marking a reason <strong>to test</strong> writes a hypothesis; the checks below decide whether it may be recorded. </>}Proposing an action records it for the review.
        </HowToRead>
      </header>

      {answer.isPending && <LoadingBlock rows={10} />}
      {answer.isError &&
        (notServed(answer.error) ? (
          <EmptyState
            title="This backend does not answer “what can we do?” yet."
            reason="The reasons and the actions come from the project's process pack through the run. Read the expectations behind the shortfall on the Why screen instead."
            action={{ label: "Back to Why", ...whyHref }}
          />
        ) : (
          <ErrorBlock error={answer.error} retry={() => void answer.refetch()} />
        ))}

      {data && drivers.length === 0 && (
        <Card>
          <p className="reading text-sm text-text-muted">
            No expectation of this group is missed more than everywhere else, so there is nothing to act on here. Look at a group further down the ranked list, or at the whole run.
          </p>
        </Card>
      )}

      {selected && drivers.length > 0 && <h2 className="text-lg font-semibold" data-testid="whole-group-suggestions">Suggestions for the whole group</h2>}
      {drivers.map((d, i) => (
        <DriverCard
          key={d.constraint_id}
          driver={d}
          rank={i + 1}
          noun={noun}
          onTest={selected ? undefined : (driver, reason) => {
            setToTest((t) => ({ constraint: driver.constraint_id, statement: reason.text, nonce: t.nonce + 1 }));
            void navigate({ to: ".", search: (s) => ({ ...s, constraint: driver.constraint_id }), replace: true });
            window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#hypothesis-statement")?.focus());
          }}
          onPropose={(driver, action) => setDraft({ title: action.text, countermeasure: action.countermeasure, owner_role: roleWords(action.owner_role), constraint: driver.constraint_id })}
          form={
            draft && draft.constraint === d.constraint_id ? (
              <ActionForm key={`${d.constraint_id}-${draft.title}`} projectId={ctx.projectId} runId={runId} slicing={slicing} sliceKey={sliceKey} view={view} filter={search.filter} within={search.within} draft={draft} onDone={() => setDraft(undefined)} />
            ) : null
          }
        />
      ))}

      {draft && !draft.constraint && (
        <ActionForm projectId={ctx.projectId} runId={runId} slicing={slicing} sliceKey={sliceKey} view={view} filter={search.filter} within={search.within} draft={draft} onDone={() => setDraft(undefined)} />
      )}
      {(!draft || !!draft.constraint) && drivers.length > 0 && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setDraft({ title: "" })}>
            Propose an action of your own
          </Button>
        </div>
      )}

      <Card data-testid="act-gates">
        <CardTitle>{selected ? `Checks for the selected ${noun}` : "Before acting on this"}</CardTitle>
        <GatesBlock projectId={ctx.projectId} runId={runId} slicing={slicing} sliceKey={sliceKey} view={view} filter={search.filter} within={search.within} constraints={constraints} draft={toTest} />
      </Card>

      <OpenFindings projectId={ctx.projectId} runId={runId} slicing={slicing} sliceKey={sliceKey} noun={noun} />

      <p className="text-sm text-text-muted">
        The reasons and the actions on this screen are the same pages the{" "}
        <Link to="/p/$projectId/knowledge" params={{ projectId: ctx.projectId }} className="text-accent-text underline">
          knowledge hub
        </Link>{" "}
        carries, so a word means one thing in both places. <Link {...whyHref} className="text-accent-text underline">Back to why this group is worst →</Link>
      </p>
    </div>
  );
}
