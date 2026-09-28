import { useState } from "react";
import { Button } from "@/components/ui/button";
import { investigationFamilies, type InvestigationFamily, type InvestigationParams } from "@/lib/api/investigation";

import { familyLabels } from "./questionCopy";

export function QuestionControls({params, activities, onApply}: {
  params: InvestigationParams;
  activities: {values:string[];total:number;truncated:boolean};
  onApply: (params:InvestigationParams)=>void;
}) {
  const [family,setFamily] = useState<InvestigationFamily>(params.family ?? "overview");
  const [activity,setActivity] = useState(params.activity ?? "");
  const [source,setSource] = useState(params.source ?? "");
  const [target,setTarget] = useState(params.target ?? "");
  const [relation,setRelation] = useState<"direct"|"eventual">(params.relation ?? "direct");
  const pair = family === "timing" || family === "sequence";
  const single = ["frequency","repetition","boundaries"].includes(family);
  const options = [...new Set([...activities.values, ...[activity,source,target].filter(Boolean)])];
  const selectClass = "mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm";
  return <form className="surface space-y-3 p-4" aria-label="Choose an analysis question" onSubmit={e=>{
    e.preventDefault();
    onApply({filter:params.filter,family,...(single && activity ? {activity}:{}),...(pair ? {source,target,relation}:{})});
  }}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-[2_1_280px] text-sm font-medium">What would you like to understand?
        <select className={selectClass} value={family} onChange={e=>setFamily(e.target.value as InvestigationFamily)}>{investigationFamilies.map(f=><option key={f} value={f}>{familyLabels[f]}</option>)}</select>
      </label>
      {single && <label className="min-w-0 flex-[2_1_260px] text-sm font-medium">Activity
        <select className={selectClass} value={activity} onChange={e=>setActivity(e.target.value)}><option value="">Most common patterns</option>{options.map(a=><option key={a}>{a}</option>)}</select>
      </label>}
      {pair && <>
        <label className="min-w-0 flex-[2_1_230px] text-sm font-medium">From activity<select required className={selectClass} value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose an activity</option>{options.map(a=><option key={a}>{a}</option>)}</select></label>
        <label className="min-w-0 flex-[2_1_230px] text-sm font-medium">To activity<select required className={selectClass} value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose an activity</option>{options.map(a=><option key={a}>{a}</option>)}</select></label>
        <label className="min-w-0 flex-[1_1_230px] text-sm font-medium">Relationship<select className={selectClass} value={relation} onChange={e=>setRelation(e.target.value as "direct"|"eventual")}><option value="direct">Next recorded event</option><option value="eventual">Later in the recorded path</option></select></label>
      </>}
      <Button type="submit">Explore this question</Button>
    </div>
    <p className="text-xs text-text-muted">Activities come from this run. Common patterns are descriptive starting points, not a ranking of business problems.</p>
    {pair && <p className="text-xs text-text-muted">{relation === "direct" ? "Counts every adjacent pair, including repeats." : "Uses the first source event and the first target later in the recorded path. Exact cohort drill-down is unavailable for this relationship."} Equal timestamps do not establish the business order.</p>}
    {activities.truncated && <p role="status" className="text-xs text-text-muted">The picker shows the {activities.values.length} most frequent activities out of {activities.total}. Other activities remain in the analysis.</p>}
  </form>;
}
