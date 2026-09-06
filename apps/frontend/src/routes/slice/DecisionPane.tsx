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
import { cn } from "@/lib/utils";

const HOTSPOTS: HotspotType[] = ["severity", "mechanism", "reservoir"];
const DISPOSITIONS: { id: Disposition; label: string; hint: string }[] = [
  { id: "investigate", label: "investigate", hint: "proceeds to mechanism analysis" },
  { id: "defer", label: "defer", hint: "stays in the backlog" },
  { id: "waive", label: "waive", hint: "accepted shortfall" },
  { id: "not_a_hotspot", label: "not a hotspot", hint: "returns a threshold to elicitation" },
];

export interface DecisionPaneProps {
  projectId: string;
  runId: string;
  slicing: string;
  row: BacklogRow;
  layerName?: string;
  focus?: boolean;
  className?: string;
}

/**
 * Decision pane (UX-5): the only place where the analyst writes. It never scrolls away.
 * A note is required only for human decisions: overriding the computed hotspot type and setting a disposition.
 */
export function DecisionPane({ projectId, runId, slicing, row, layerName, focus, className }: DecisionPaneProps) {
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
  const needsDispositionNote = !!disposition && !dispositionNote.trim();
  const canSave = !needsOverrideNote && !needsDispositionNote && (overridden || !!disposition || !!owner.trim());

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
  };

  return (
    <aside className={cn("sticky-pane surface flex flex-col gap-3 p-4", className)} aria-labelledby="decision-heading">
      <h2 id="decision-heading" className="text-sm font-semibold">
        Decision
      </h2>
      <p className="text-xs text-text-muted">
        Computed reading: {computed ? <KindBadge hotspotType={computed} short /> : "no kind yet"} · <Term id="dominant_layer" primaryOnly /> <LayerChip id={row.dominant_layer} name={layerName} />
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-text-muted">
          <Term id="kind" /> (override needs a note)
        </legend>
        <div className="flex gap-1" role="radiogroup" aria-label="kind of problem">
          {HOTSPOTS.map((h, i) => (
            <button
              key={h}
              ref={i === 0 ? first : undefined}
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-text-muted">disposition (needs a note)</legend>
        <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="disposition">
          {DISPOSITIONS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={disposition === d.id} title={d.hint} onClick={() => setDisposition(disposition === d.id ? undefined : d.id)} className={cn("rounded border px-2 py-1 text-xs", disposition === d.id ? "border-accent bg-accent-subtle text-accent-text" : "border-border hover:bg-surface-sunken")}>
              {d.label}
            </button>
          ))}
        </div>
        {disposition && (
          <Field label="note *" htmlFor="disposition-note" hint={DISPOSITIONS.find((d) => d.id === disposition)?.hint}>
            <Textarea id="disposition-note" value={dispositionNote} onChange={(e) => setDispositionNote(e.target.value)} placeholder="One line: the reading and who was present" aria-invalid={needsDispositionNote} />
          </Field>
        )}
      </fieldset>

      <Field label="owner" htmlFor="owner" hint="No note needed.">
        <Input id="owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="name or role" />
      </Field>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!canSave}>
          Save finding
        </Button>
        {existing && (
          <Button variant="ghost" size="sm" onClick={() => { remove(id); setType(computed); setOverrideNote(""); setDisposition(undefined); setDispositionNote(""); setOwner(""); setSaved(undefined); }}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-text-subtle" aria-live="polite">
        {saved ? `Saved ${fmtDateTime(saved)}` : existing ? `Last saved ${fmtDateTime(existing.updatedAt)}` : "Nothing saved yet. Findings stay in this browser until the review endpoints arrive."}
      </p>
    </aside>
  );
}
