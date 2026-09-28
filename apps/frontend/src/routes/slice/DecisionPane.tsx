import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BacklogRow, HotspotType } from "@wise/api-schema";
import { KindBadge, LayerChip } from "@/components/badges";
import { Term } from "@/components/Term";
import { kindOf } from "@/lib/vocabulary";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { fmtDateTime } from "@/lib/format";
import type { ReviewItem } from "@/lib/api/review";
import { findingMatchesScope, useScopedFinding } from "@/lib/api/findings";
import { http } from "@/lib/api/transport";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

const HOTSPOTS: HotspotType[] = ["severity", "mechanism", "reservoir"];
type Disposition = "investigate" | "defer" | "waive" | "not_a_hotspot";
const DISPOSITIONS: { id: Disposition; label: string; method: string; hint: string }[] = [
  { id: "investigate", label: "Investigate", method: "investigate", hint: "proceeds to mechanism analysis" },
  { id: "defer", label: "Defer", method: "defer", hint: "stays in the backlog" },
  { id: "waive", label: "Accept the shortfall", method: "waive", hint: "accepted shortfall" },
  { id: "not_a_hotspot", label: "Not a problem", method: "not a hotspot", hint: "returns a threshold to elicitation" },
];

export interface DecisionPaneProps {
  projectId: string;
  runId: string;
  slicing: string;
  row: BacklogRow;
  /** The explicitly selected perspective; no default may silently replace it. */
  view?: string;
  /** Raw URL filter, retained even if invalid so the server can reject it. */
  filter?: string;
  /** Drill scopes are not supported by finding capture yet. */
  within?: string;
  layerName?: string;
  /** The plain phrase of the top expectation, for the reading line. */
  missed?: string;
  focus?: boolean;
  className?: string;
  /** Called after a finding was saved, with what was saved. */
  onSaved?: () => void;
}

/**
 * Decision pane (UX-5): the only place where the analyst writes. It never scrolls away.
 * A note is required only for human decisions: overriding the computed hotspot type and setting a disposition.
 */
export function DecisionPane(props: DecisionPaneProps) {
  // A scope change creates a fresh editor: drafts and in-flight replies cannot
  // migrate into another view or selection.
  const key = JSON.stringify([props.projectId, props.runId, props.slicing, props.row.key, props.view, props.filter, props.within]);
  return <ScopedDecisionPane key={key} {...props} />;
}

function ScopedDecisionPane({ projectId, runId, slicing, row, view, filter, within, layerName, missed, focus, className, onSaved }: DecisionPaneProps) {
  const queryClient = useQueryClient();
  const scope = { projectId, runId, slicing, sliceKey: row.key, view, filter, within };
  const findings = useScopedFinding(scope);
  const existing = findings.finding;
  const computed = row.hotspot_type ?? undefined;
  const [type, setType] = useState<HotspotType | undefined>(computed);
  const [overrideNote, setOverrideNote] = useState("");
  const [disposition, setDisposition] = useState<Disposition>();
  const [dispositionNote, setDispositionNote] = useState("");
  const [owner, setOwner] = useState("");
  const [saved, setSaved] = useState<ReviewItem>();
  const [loaded, setLoaded] = useState(false);
  const loadedOnce = useRef(false);
  const mounted = useRef(true);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!findings.isSuccess || findings.isFetching || loadedOnce.current) return;
    loadedOnce.current = true;
    const kind = existing?.hotspotType;
    setType(typeof kind === "string" && HOTSPOTS.includes(kind as HotspotType) ? kind as HotspotType : computed);
    setOverrideNote(typeof existing?.overrideNote === "string" ? existing.overrideNote : "");
    setDisposition(DISPOSITIONS.find((d) => d.id === existing?.status)?.id);
    setDispositionNote(existing?.note ?? "");
    setOwner(typeof existing?.owner_role === "string" ? existing.owner_role : "");
    setLoaded(true);
  }, [findings.isSuccess, findings.isFetching, existing, computed]);

  useEffect(() => {
    if (focus && loaded) first.current?.focus();
  }, [focus, loaded]);

  const overridden = !!type && type !== computed;
  void layerName;
  const needsOverrideNote = overridden && !overrideNote.trim();
  // a note is required for every answer to "What next?"
  const needsDispositionNote = !!disposition && !dispositionNote.trim();
  const save = useMutation({
    mutationFn: async () => {
      const finding = await http.post<ReviewItem>(`/projects/${encodeURIComponent(projectId)}/findings`, {
        title: missed || "Assessment finding", runId, slicing, sliceKey: row.key, view, filter,
        status: disposition ?? "open", note: dispositionNote.trim(), owner_role: owner.trim() || undefined,
        hotspotType: type, overrideNote: overridden ? overrideNote.trim() : undefined,
      });
      if (!findingMatchesScope(finding, scope) || finding.evidenceState !== "recorded") {
        throw new Error("The server did not confirm this finding's exact evidence scope. Reload findings before retrying.");
      }
      return finding;
    },
    retry: false,
    onSuccess: (finding) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "findings"] });
      if (mounted.current) {
        setSaved(finding);
        // Keep the editor open so the parent cannot hide an unavailable-selection
        // explanation behind its normal close-on-save callback.
        if (finding.evidenceContext?.selectionState !== "unavailable") onSaved?.();
      }
    },
  });
  const scopeError = within !== undefined
    ? "Saving this drilled selection is not supported yet. Open its assessed group to record a finding."
    : !view ? "Choose a perspective before saving this finding." : undefined;
  const busy = !loaded || findings.isError || save.isPending || !!scopeError;
  const canSave = !busy && !needsOverrideNote && !needsDispositionNote && !!dispositionNote.trim() && (overridden || !!disposition || !!owner.trim());
  const evidence = (saved ?? existing)?.evidenceContext;
  const plain = useUiStore((s) => s.vocabulary) === "plain";
  const guided = useUiStore((s) => s.mode === "guided");


  return (
    <aside className={cn("sticky-pane surface flex flex-col gap-3 p-4", className)} aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="text-sm font-semibold">
        Decision
      </h2>
      <p className="text-xs text-text-muted" data-testid="decision-reading">
        Reading: {computed ? <KindBadge hotspotType={computed} short /> : "no kind yet"}
        {missed ? `, ${missed}` : ""}
        {!plain && (
          <>
            {" · "}
            <Term id="dominant_layer" primaryOnly /> <LayerChip id={row.dominant_layer} name={layerName} />
          </>
        )}
      </p>

      {scopeError && <p role="alert" className="text-sm">{scopeError}</p>}
      {findings.isError && <p role="alert" className="text-sm">Could not load saved findings: {findings.error.message}. Saving is unavailable until the server can be reached.</p>}
      {save.isError && <p role="alert" className="text-sm">Save could not be confirmed: {save.error.message}. Nothing was saved in this browser.</p>}
      {(findings.isError || save.isError) && <Button variant="outline" size="sm" onClick={() => { save.reset(); loadedOnce.current = false; void findings.refetch(); }}>Reload findings</Button>}
      {evidence?.selectionState === "unavailable" && <p role="alert" className="text-sm">Saved selection is not measured: {evidence.selectionReason ?? "Exact evidence is unavailable."}</p>}
      {evidence?.scenario && <p className="text-sm">Hypothetical scenario finding; this is not observed evidence.</p>}

      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="text-xs font-medium text-text-muted">What next?</legend>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="What next?">
          {DISPOSITIONS.map((d, i) => (
            <button
              key={d.id}
              ref={i === 0 ? first : undefined}
              type="button"
              role="radio"
              aria-checked={disposition === d.id}
              title={`${d.hint} (${d.method})`}
              onClick={() => setDisposition(disposition === d.id ? undefined : d.id)}
              className={cn("rounded border px-2 py-1 text-xs", disposition === d.id ? "border-accent bg-accent-subtle text-accent-text" : "border-border hover:bg-surface-sunken")}
            >
              {plain ? d.label : d.method}
            </button>
          ))}
        </div>
        <Field label="note *" htmlFor="disposition-note" hint={disposition ? DISPOSITIONS.find((d) => d.id === disposition)?.hint : undefined}>
          <Textarea id="disposition-note" value={dispositionNote} onChange={(e) => setDispositionNote(e.target.value)} placeholder="why, in one line" aria-invalid={needsDispositionNote} />
        </Field>
      </fieldset>

      {!guided && (
        <Field label="owner" htmlFor="owner">
          <Input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="name or role" disabled={busy} />
        </Field>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={!canSave}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-text-subtle" aria-live="polite" data-testid="decision-status">
        {findings.isPending ? "Loading saved findings…" : findings.isError ? "Saved findings unavailable." : saved ? `Saved on server ${fmtDateTime(saved.updatedAt)}` : existing ? `Last saved on server ${fmtDateTime(existing.updatedAt)}` : "No server finding for this selection yet."}
      </p>
      <p className="text-xs text-text-subtle">Each save records a new revision for this run, perspective and selection. Earlier findings are retained.</p>

      {/* R3-10: guided mode reduces the pane to *What next?* and a note — the kind of problem is computed and
          the method's terms are not a question the guided reader came to answer */}
      {!guided && (
      <details className="text-xs">
        <summary className="cursor-pointer text-text-muted">Change the kind</summary>
        <fieldset className="mt-2 flex flex-col gap-2" disabled={busy}>
          <legend className="sr-only">
            <Term id="kind" /> (override needs a note)
          </legend>
          <div className="flex gap-1" role="radiogroup" aria-label="kind of problem">
            {HOTSPOTS.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={type === h}
                aria-label={`${kindOf({ hotspot_type: h })} (${h})`}
                onClick={() => setType(h)}
                className={cn("flex-1 rounded border px-2 py-1 text-xs", type === h ? "border-accent bg-accent-subtle" : "border-border hover:bg-surface-sunken")}
              >
                <KindBadge hotspotType={h} short />
              </button>
            ))}
          </div>
          {overridden && (
            <Field label="why override *" htmlFor="override-note">
              <Textarea id="override-note" value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Evidence outside the log; who agreed" aria-invalid={needsOverrideNote} />
            </Field>
          )}
        </fieldset>
      </details>
      )}
      {!guided && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-muted">Method terms</summary>
          <p className="mt-1 text-text-muted">
            What next? is the method's <em>disposition</em> (investigate · defer · waive · not a hotspot); the kind of problem is the <em>hotspot type</em> ({computed ?? "not typed"}). Overriding the computed kind needs a note.
          </p>
        </details>
      )}
    </aside>
  );
}
