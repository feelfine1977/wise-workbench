import type { InvestigationFamily } from "@/lib/api/investigation";

export const familyLabels: Record<InvestigationFamily, string> = {
  overview: "Explore recorded patterns",
  frequency: "How often does an activity happen?",
  repetition: "Which activities repeat?",
  timing: "How much time passes between activities?",
  sequence: "In what order do activities happen?",
  boundaries: "Where do recorded paths start and end?",
  identity: "What do we know about execution identities?",
  missingness: "Which data is missing?",
};
