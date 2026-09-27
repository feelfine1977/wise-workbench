/** View identity colours are not performance scores. Always pair with a visible name. */
export function viewColor(name: string): string {
  const known: Record<string, string> = { finance: "#2563a6", logistics: "#087f8c", automation: "#7851a9", compliance: "#9a6700", quality: "#b54b73", service: "#087f8c", sales: "#7851a9", "customer service": "#9a6700", "report candidates": "#b54b73" };
  if (known[name.toLowerCase()]) return known[name.toLowerCase()]!;
  const colors = ["#2563a6", "#087f8c", "#7851a9", "#9a6700", "#b54b73"];
  return colors[Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length]!;
}
export function normViewNames(norm: Record<string, unknown> | undefined): string[] {
  return Array.isArray(norm?.views) ? norm.views.flatMap((v: unknown) => v && typeof v === "object" && "name" in v && typeof v.name === "string" ? [v.name] : []) : [];
}
