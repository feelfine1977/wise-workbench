export function constraintFamily(type: string): string {
  return ({ presence: "Completion", exclusion: "Absence", precedence: "Order", response: "Order", lag: "Time", singularity: "Repetition", metric: "Values", balance: "Values" } as Record<string, string>)[type] ?? "Other rules";
}
