import { investigationFamilies, type InvestigationParams } from "@/lib/api/investigation";
import { selectionParam } from "./search";

/** A malformed question must not silently become a different analysis. */
export function validateInvestigationSearch(s: Record<string, unknown>): InvestigationParams & {question?:string;view?:string;slicing?:string} {
  const family = investigationFamilies.find(f => f === s.family);
  if (s.family !== undefined && family === undefined) throw new Error("Unknown process question. Choose a question from the analysis controls.");
  const relation = s.relation === "direct" || s.relation === "eventual" ? s.relation : undefined;
  if (s.relation !== undefined && relation === undefined) throw new Error("Unknown activity relationship. Choose next recorded event or later in the recorded path.");
  return {
    question: typeof s.question === "string" ? s.question : undefined,
    filter: selectionParam(s.filter),
    view: typeof s.view === "string" ? s.view : undefined,
    slicing: typeof s.slicing === "string" ? s.slicing : undefined,
    family,
    activity: typeof s.activity === "string" ? s.activity : undefined,
    source: typeof s.source === "string" ? s.source : undefined,
    target: typeof s.target === "string" ? s.target : undefined,
    relation,
  };
}
