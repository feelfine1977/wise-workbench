import { useEffect, useRef, useState } from "react";
import type { BacklogRow, HotspotType } from "@wise/api-schema";
import { KindBadge, LayerChip } from "@/components/badges";
import { Term } from "@/components/Term";
import { kindOf } from "@/lib/vocabulary";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { fmtDateTime } from "@/lib/format";
import { findingId, useFindingStore, type Disposition } from "@/lib/stores/findings";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

const HOTSPOTS: HotspotType[] = ["severity", "mechanism", "reservoir"];
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
export function DecisionPane({ projectId, runId, slicing, row, layerName, missed, focus, className, onSaved }: DecisionPaneProps) {
  const id = findingId(runId, slicing, row.key);
  const existing = useFindingStore((s) => s.findings[id]);
  const upsert = useFindingStore((s) => s.upsert);
  const remove = useFindingStore((s) => s.remove);
  const computed = row.hotspot_type ?? undefined;
  const [type, setType] = useState<HotspotType | undefined>(existing?.hotspotType ?? computed);
  const [overrideNote, setOverrideNote] = useState(existing?.overrideNote ?? "");
  const [disposition, setDisposition] = useState<Disposition | undefined>(existing?.disposition);
  const [dispositionNote, setDispositionNote] = useState(existing?.dispositionNote ?? "");
  const [owner, setOwner] = useState(existing?.owner ?? "");
  const [saved, setSaved] = useState<string>();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focus) first.current?.focus();
  }, [focus]);

  const overridden = !!type && type !== computed;
  void layerName;
  const needsOverrideNote = overridden && !overrideNote.trim();
  // a note is required for every answer to "What next?"
  const needsDispositionNote = !!disposition && !dispositionNote.trim();
  const canSave = !needsOverrideNote && !needsDispositionNote && !!dispositionNote.trim() && (overridden || !!disposition || !!owner.trim());

  const save = () => {
    const f = upsert({
      projectId,
      runId,
      slicing,
      key: row.key,
      computedType: computed,
      hotspotType: type,
      overrideNote: overridden ? overrideNote.trim() : undefined,
      disposition,
      dispositionNote: disposition ? dispositionNote.trim() : undefined,
      owner: owner.trim() || undefined,
    });
    setSaved(f.updatedAt);
    onSaved?.();
  };
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

      <fieldset className="flex flex-col gap-2">
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
          <Input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="name or role" />
        </Field>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!canSave}>
          Save
        </Button>
        {existing && (
          <Button variant="ghost" size="sm" onClick={() => { remove(id); setType(computed); setOverrideNote(""); setDisposition(undefined); setDispositionNote(""); setOwner(""); setSaved(undefined); }}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-text-subtle" aria-live="polite" data-testid="decision-status">
        {saved ? `Saved ${fmtDateTime(saved)}` : existing ? `Last saved ${fmtDateTime(existing.updatedAt)}` : "Nothing saved yet. Findings stay in this browser until they can be saved with the run."}
      </p>

      {/* R3-10: guided mode reduces the pane to *What next?* and a note — the kind of problem is computed and
          the method's terms are not a question the guided reader came to answer */}
      {!guided && (
      <details className="text-xs">
        <summary className="cursor-pointer text-text-muted">Change the kind</summary>
        <fieldset className="mt-2 flex flex-col gap-2">
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
