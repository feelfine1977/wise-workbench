/**
 * One page of the knowledge hub, in the panel's own template
 * (`docs/panel/knowledge_hub_panel.md` §3), used by the hub route and by the side panel a
 * *What does this mean?* chip opens, so a word means the same thing in both places:
 *
 *   [plain name]                                        [method term]
 *   What this means · Why it matters · How we detect it
 *   What usually causes it (in the log: check … | outside the log: ask …)
 *   What usually helps (countermeasure type · owner role · effect area)
 *   What to check first · Examples
 *   Related: stage · expectations · failure modes · KPIs
 *   Your organisation's note
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { GuidanceText, HubNode, HubPage, HubRelated, UsualAction, UsualReason } from "@/lib/api/cycle4";
import { useSetOverlay } from "@/lib/api/cycle4";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { KIND_WORDS, measureWords, readableSources, roleWords } from "@/components/knowledge/words";
import { cn } from "@/lib/utils";

function Block({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

/** The reason list, split as the panel asks: what the log can show, and whom to ask when it cannot. */
export function ReasonList({ reasons, className }: { reasons: UsualReason[] | undefined; className?: string }) {
  if (!reasons?.length) return null;
  return (
    <ul className={cn("flex flex-col gap-2 text-sm", className)} data-testid="usual-reasons">
      {reasons.map((r, i) => {
        const outside = r.where === "outside";
        return (
          <li key={`${r.text}-${i}`} className="flex flex-col gap-0.5">
            <span className="reading text-text">{r.text}</span>
            <span className="text-xs text-text-muted">
              <span className={cn("mr-1 rounded-sm px-1 py-0.5 text-[11px]", outside ? "bg-warning-subtle text-warning" : "bg-surface-sunken text-text-muted")}>{outside ? "outside the log — ask" : "in the log — check"}</span>
              {r.check ?? (outside ? "the people who run the step" : "the events of these items")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The action list with its countermeasure type and the role that usually owns it. */
export function ActionList({ actions, className }: { actions: UsualAction[] | undefined; className?: string }) {
  if (!actions?.length) return null;
  return (
    <ul className={cn("flex flex-col gap-2 text-sm", className)} data-testid="usual-actions">
      {actions.map((a, i) => (
        <li key={`${a.text}-${i}`} className="flex flex-col gap-0.5">
          <span className="reading text-text">{a.text}</span>
          <span className="text-xs text-text-muted">
            {[measureWords(a.countermeasure), roleWords(a.owner_role)].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RelatedList({ related, onOpen }: { related: HubRelated | undefined; onOpen?: (nodeId: string) => void }) {
  if (!related) return null;
  const groups: { label: string; nodes: HubNode[] }[] = [
    { label: "stage", nodes: related.stage ? [related.stage] : [] },
    { label: "expectation areas", nodes: related.layers ?? [] },
    { label: "expectations", nodes: related.expectations ?? [] },
    { label: "failure modes", nodes: related.failure_modes ?? [] },
    { label: "indicators", nodes: related.kpis ?? [] },
  ].filter((g) => g.nodes.length > 0);
  if (!groups.length) return null;
  return (
    <Block title="Related" testId="hub-related">
      <dl className="flex flex-col gap-1.5 text-sm">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className="text-xs uppercase tracking-wide text-text-subtle">{g.label}</dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              {g.nodes.slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-accent-text hover:bg-surface-sunken"
                  onClick={() => onOpen?.(n.id)}
                  title={n.method_name ?? undefined}
                >
                  {n.plain_name ?? n.method_name ?? n.id}
                </button>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

/** Your organisation's note (RK-5): added to the pack's text and never replacing it. */
function Overlay({ projectId, kind, entryId, overlay }: { projectId: string; kind: string; entryId: string; overlay: GuidanceText | null | undefined }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(overlay?.note ?? "");
  const [author, setAuthor] = useState(overlay?.author ?? "");
  const save = useSetOverlay(projectId, kind, entryId);
  const canSave = note.trim().length > 0 && author.trim().length > 0 && !save.isPending;
  return (
    <Block title="Your organisation's note" testId="hub-overlay">
      {overlay?.note && !editing && (
        <div className="rounded-md border border-accent/40 bg-accent-subtle p-3 text-sm">
          <p className="reading text-text">{overlay.note}</p>
          <p className="mt-1 text-xs text-text-muted">
            {[overlay.author, overlay.review_status].filter(Boolean).join(" · ") || "written in this project"}
          </p>
        </div>
      )}
      {!editing && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {overlay?.note ? "Change the note" : "Add your organisation's note"}
          </Button>
          {!overlay?.note && <p className="mt-1 text-xs text-text-subtle">The text above comes from the process pack. A note here is added to it, never instead of it.</p>}
        </div>
      )}
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            save.mutate({ note: note.trim(), author: author.trim() }, { onSuccess: () => setEditing(false) });
          }}
        >
          <label className="text-xs text-text-muted" htmlFor={`overlay-note-${entryId}`}>
            In our company this usually means…
          </label>
          <Textarea id={`overlay-note-${entryId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this means here, what it usually comes from, what we do about it." />
          <label className="text-xs text-text-muted" htmlFor={`overlay-author-${entryId}`}>
            Who is writing this
          </label>
          <Input id={`overlay-author-${entryId}`} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or role" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!canSave}>
              {save.isPending ? "Saving…" : "Save the note"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {!canSave && (note.trim() || author.trim()) && <p className="text-xs text-warning">A note needs both the text and who wrote it.</p>}
          {save.isError && <p className="text-xs text-danger">The note could not be saved on this backend; it is kept on the screen only.</p>}
        </form>
      )}
    </Block>
  );
}

export interface HubTemplateProps {
  projectId: string;
  page: HubPage;
  /** Opens another node in the same place (the panel) or navigates (the route). */
  onOpen?: (nodeId: string) => void;
  /** The route shows the full page; the panel hides the related lists' second half. */
  compact?: boolean;
  className?: string;
}

export function HubTemplate({ projectId, page, onOpen, compact, className }: HubTemplateProps) {
  const node = page.node;
  const g = page.guidance ?? {};
  const title = node.plain_name ?? g.plain_name ?? node.method_name ?? node.id;
  const method = node.method_name && node.method_name !== title ? node.method_name : g.expectation && g.expectation !== title ? undefined : undefined;
  const entryKind = node.kind === "expectation" ? "constraint" : node.kind;
  const entryId = node.constraint_id ?? node.id.split(":").slice(-1)[0] ?? node.id;
  return (
    <article className={cn("flex flex-col gap-4", className)} data-testid="hub-page" data-node={node.id}>
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-text">{title}</h2>
          <Badge variant="outline" className="shrink-0">
            {KIND_WORDS[node.kind] ?? node.kind}
          </Badge>
        </div>
        {method && <p className="text-sm text-text-muted">{method}</p>}
        {node.missed_label && <p className="text-sm text-text-muted">When it is missed, we call it: {node.missed_label}.</p>}
      </header>

      {g.expectation && (
        <Block title="What is expected" testId="hub-expectation">
          <p className="reading text-sm text-text">{g.expectation}</p>
        </Block>
      )}
      {g.meaning_when_missed && (
        <Block title="What this means when it is missed" testId="hub-meaning">
          <p className="reading text-sm text-text">{g.meaning_when_missed}</p>
        </Block>
      )}
      {g.why_it_matters && (
        <Block title="Why it matters" testId="hub-why">
          <p className="reading text-sm text-text">{g.why_it_matters}</p>
        </Block>
      )}
      {g.how_detected && (
        <Block title="How we detect it" testId="hub-detected">
          <p className="reading text-sm text-text">{g.how_detected}</p>
        </Block>
      )}
      {g.usual_reasons?.length ? (
        <Block title="What usually causes it">
          <p className="text-xs text-text-subtle">These are candidates to check, not findings.</p>
          <ReasonList reasons={g.usual_reasons} />
        </Block>
      ) : null}
      {g.usual_actions?.length ? (
        <Block title="What usually helps">
          <ActionList actions={g.usual_actions} />
        </Block>
      ) : null}
      {g.what_to_check_first?.length ? (
        <Block title="What to check first" testId="hub-check-first">
          <ol className="flex list-inside list-decimal flex-col gap-1 text-sm text-text">
            {g.what_to_check_first.map((c) => (
              <li key={c} className="reading">
                {c}
              </li>
            ))}
          </ol>
        </Block>
      ) : null}
      {!compact && g.examples?.length ? (
        <Block title="Examples" testId="hub-examples">
          <ul className="flex flex-col gap-1.5 text-sm">
            {g.examples.map((e, i) => (
              <li key={i} className="reading text-text">
                <span className="mr-1 text-xs uppercase tracking-wide text-text-subtle">{e.kind === "compliant" ? "as expected" : "missed"}</span>
                {e.text}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      <RelatedList related={page.related} onOpen={onOpen} />
      {!compact && (g.owner_role || g.kpis?.length) ? (
        <Block title="Who owns it, and what it moves" testId="hub-owner">
          <p className="text-sm text-text-muted">
            {/* the indicators are named in the *indicators* block above, by their plain names; repeating them
                here printed their ids into the prose (P1-13) */}
            {roleWords(g.owner_role) ? `Usually accountable: ${roleWords(g.owner_role)}.` : ""}
          </p>
        </Block>
      ) : null}
      <Overlay projectId={projectId} kind={entryKind} entryId={entryId} overlay={page.overlay} />
      {/* a source the reader can go to, never a file of this repository: the page printed
          "docs/panel/knowledge_hub_panel.md §1 and §5; failure_modes.yaml (p2p)" under every expectation (P1-13) */}
      {!compact && readableSources(g.sources).length ? <p className="text-xs text-text-subtle">Sources: {readableSources(g.sources).join("; ")}</p> : null}
    </article>
  );
}
