/** Open content metadata shared by measured cards and their Knowledge Hub definitions. */
export interface SolutionCardBlock {
  id: string;
  kind: "activity_coverage" | "endpoint_duration" | "end_day_of_month" | "due_date_lead";
  title: string;
  question: string;
  requires: string[];
  calculation: string;
  presentation: "coverage" | "summary" | "day_bars" | "availability";
  missingData: string;
  interpretation: string;
}

export interface SolutionCard {
  id: string;
  version: number;
  title: string;
  intent: string;
  blocks: SolutionCardBlock[];
  hubNode: string | null;
  process: string | null;
}
