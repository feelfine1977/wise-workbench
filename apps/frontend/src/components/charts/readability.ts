/** Keep data labels as text when ECharts renders an HTML tooltip. */
export function escapeChartText(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export const readableTooltip = {
  confine: true,
  textStyle: { fontSize: 13, lineHeight: 20 },
  extraCssText: "max-width: min(32rem, 70vw); white-space: normal; overflow-wrap: anywhere;",
};

/** Equal category bands need room for the longest wrapped label, including unbroken IDs. */
export function horizontalCategoryLayout(labels: string[], minimumHeight: number) {
  const lines = Math.max(1, ...labels.map((label) => label.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(Array.from(line).length / 18)), 0)));
  return {
    height: Math.max(minimumHeight, 100 + labels.length * Math.max(40, lines * 18 + 12)),
    grid: { left: 192, right: 32, top: 48, bottom: 52 },
    yAxis: {
      type: "category" as const,
      inverse: true,
      data: labels,
      axisLabel: { interval: 0, fontSize: 13, lineHeight: 18, width: 168, overflow: "break" as const, margin: 12 },
      axisTick: { show: false },
    },
  };
}
