import { expect, it } from "vitest";
import type { CaseTable, Run } from "@wise/api-schema";
import { compatibleAssessments } from "./ExistingAssessments";

const table:CaseTable={id:"table",datasetId:"data",status:"ready",cases:12,createdAt:"2026-09-27"};
const run:Run={id:"run",caseTableId:"table",normVersionId:"norm",status:"done",createdAt:"2026-09-27",paramsHash:"hash"};
const ctx={datasetBindingState:"bound" as const,datasetBinding:{projectId:"project",datasetId:"data",boundAt:"2026-09-27"},caseTable:table,projectRuns:[run,{...run,id:"scenario"},{...run,id:"other-table",caseTableId:"older"},{...run,id:"queued",status:"queued" as const}]};
it("offers only completed observed assessments of the exact bound preparation",()=>{
  expect(compatibleAssessments(ctx,["scenario"]).map(r=>r.id)).toEqual(["run"]);
});
it("fails closed on unknown scenarios, unbound data and conflicting preparation",()=>{
  expect(compatibleAssessments(ctx,undefined)).toEqual([]);
  expect(compatibleAssessments({...ctx,datasetBindingState:"unbound"},[])).toEqual([]);
  expect(compatibleAssessments({...ctx,caseTable:{...table,datasetId:"other"}},[])).toEqual([]);
  expect(compatibleAssessments({...ctx,datasetBindingConflict:{kind:"case_table",boundDatasetId:"data"}},[])).toEqual([]);
});
