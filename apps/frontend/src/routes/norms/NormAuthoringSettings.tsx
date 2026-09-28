import { useId, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useNormAuthoringPreferences, type NormAuthoringMode } from "./useNormAuthoringPreferences";

/** The same settings apply throughout the norm, including its constraint list and map. */
export function NormAuthoringSettings({ children, disabled = false }: { children?: ReactNode; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { mode, setMode, skipReasonOwner, setSkipReasonOwner, allowDraftWithoutDecision, showAdvancedControls, setAdvancedControls } = useNormAuthoringPreferences();
  return <Dialog open={open} onOpenChange={setOpen}><div className="flex flex-wrap items-center gap-3">
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled}><Settings size={15} aria-hidden="true" />Settings</Button></DialogTrigger>
    <span aria-label="Current norm settings" className="text-xs text-text-muted">{mode === "guided" ? "Guided" : "Expert"} · {allowDraftWithoutDecision ? "Reason / owner optional for drafts" : "Reason / owner required"}</span>
    </div>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Norm settings</DialogTitle><DialogDescription>Choose how to build and display this norm.</DialogDescription></DialogHeader>
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Authoring</legend>
          <label className="flex items-center gap-2" htmlFor={`${id}-mode`}>Authoring mode
            <select id={`${id}-mode`} className="h-control rounded border border-border bg-surface px-2 text-sm" value={mode} onChange={event => setMode(event.target.value as NormAuthoringMode)}>
              <option value="guided">Guided</option><option value="expert">Expert</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={skipReasonOwner} disabled={mode !== "guided"} onChange={event => setSkipReasonOwner(event.target.checked)} aria-describedby={`${id}-help`} />Skip reason and owner for draft saves</label>
          <p id={`${id}-help`} className="text-xs text-text-muted">{allowDraftWithoutDecision
            ? "Threshold-only saves stay drafts. Optional notes do not confirm threshold decisions."
            : "A reason and owner are required for changes."} Review and approval are separate. Not-applicable exclusions still need a business note. Authoring preferences are saved in this browser.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={showAdvancedControls} disabled={mode === "expert"} onChange={event => setAdvancedControls(event.target.checked)} aria-describedby={`${id}-advanced`} />Show advanced rule and list controls</label>
          <p id={`${id}-advanced`} className="text-xs text-text-muted">Show the JSON tab, complete rule and applicability parameters, list reordering and individual hide controls. Expert mode always includes these controls. Display preferences do not edit the saved norm.</p>
          <details className="text-xs"><summary className="cursor-pointer font-medium">How Guided priorities are chosen</summary>
            <div className="mt-2 space-y-2 text-text-muted"><p>Guided mode starts with applicable expectations with at least one referenced activity observed. Unknown coverage and data issues appear separately under Evidence to check. Rules with no applicable cases or missing activities are folded away. Expert mode shows saved expectations in their original order.</p><p>Within each evidence group: saved constraint importance, then observed activity share. An open group keeps its order until you choose to reorder it. Stakeholder view weights do not change this order. Activity coverage counts cases with any referenced activity. It does not establish that all required events or measurements are available, and it is not a pass rate. Missing or unmeasured activities never approve or remove a rule.</p><p>Priorities use the saved version and the selected prepared-case population. Save edits before checking their evidence. Search can find lower-evidence rules; display filters still apply in either mode.</p></div>
          </details>
        </fieldset>
        {children}
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Done</Button>
      </DialogContent>
  </Dialog>;
}
