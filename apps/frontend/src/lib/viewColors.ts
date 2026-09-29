/** View identity colours are not performance scores. Always pair with a visible name. */
export function viewColor(name: string): string {
  const known: Record<string, string> = { finance: "#12907F", logistics: "#5A36C2", automation: "#6B7C1B", compliance: "#A61E5C", general: "#3F4653", quality: "#A61E5C", service: "#0E8577", sales: "#5A36C2", "customer service": "#0E8577", "report candidates": "#A61E5C" };
  if (known[name.toLowerCase()]) return known[name.toLowerCase()]!;
  const colors = ["#12907F", "#5A36C2", "#A61E5C", "#6B7C1B", "#3F4653"];
  return colors[Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length]!;
}
export function normViewNames(norm: Record<string, unknown> | undefined): string[] {
  return Array.isArray(norm?.views) ? norm.views.flatMap((v: unknown) => v && typeof v === "object" && "name" in v && typeof v.name === "string" ? [v.name] : []) : [];
}
