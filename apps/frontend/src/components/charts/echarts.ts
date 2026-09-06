/** Lazy ECharts core with only the pieces the app uses; themes come from the design tokens. */
import lightTheme from "@wise/design-tokens/dist/echarts-theme.light.json";
import darkTheme from "@wise/design-tokens/dist/echarts-theme.dark.json";

import type * as EChartsCoreModule from "echarts/core";
import type { ECharts as EChartsInstance, EChartsCoreOption } from "echarts/core";

export type EChartsCore = typeof EChartsCoreModule;
export type ECharts = EChartsInstance;
export type EChartsOption = EChartsCoreOption;

let loading: Promise<EChartsCore> | undefined;

export function loadECharts(): Promise<EChartsCore> {
  if (!loading) {
    loading = Promise.all([import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]).then(
      ([core, charts, components, renderers]) => {
        core.use([
          charts.BarChart,
          charts.LineChart,
          charts.ScatterChart,
          charts.CustomChart,
          components.GridComponent,
          components.TooltipComponent,
          components.LegendComponent,
          components.MarkLineComponent,
          components.MarkAreaComponent,
          components.GraphicComponent,
          components.AriaComponent,
          components.VisualMapComponent,
          components.DataZoomComponent,
          components.TitleComponent,
          renderers.CanvasRenderer,
        ]);
        core.registerTheme("wise-light", lightTheme);
        core.registerTheme("wise-dark", darkTheme);
        return core;
      },
    );
  }
  return loading;
}

export const chartTokens = {
  light: lightTheme.wise,
  dark: darkTheme.wise,
};
