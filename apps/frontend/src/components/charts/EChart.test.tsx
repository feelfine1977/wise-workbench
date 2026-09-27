import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { EChartsCore } from "./echarts";
import { EChart } from "./EChart";

vi.unmock("@/components/charts/EChart");
const mock = vi.hoisted(() => ({
  load: vi.fn<() => Promise<EChartsCore>>(),
  init: vi.fn(),
  instance: {
    setOption: vi.fn(),
    on: vi.fn<(name: string, handler: (params: unknown) => void) => void>(),
    dispose: vi.fn(),
    resize: vi.fn(),
  },
}));
vi.mock("@/components/charts/echarts", () => ({ loadECharts: mock.load }));

let finishLoading: (core: EChartsCore) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mock.init.mockReturnValue(mock.instance);
  mock.load.mockReturnValue(new Promise((resolve) => { finishLoading = resolve; }));
});

async function load() {
  await act(async () => { finishLoading({ init: mock.init } as unknown as EChartsCore); });
}

it("uses the latest data and ready callback when lazy loading finishes after a filter change", async () => {
  const initialReady = vi.fn();
  const latestReady = vi.fn();
  const view = render(<EChart option={{ series: [{ data: [1] }] }} ariaLabel="Chart" onReady={initialReady} />);
  view.rerender(<EChart option={{ series: [{ data: [7, 9] }] }} ariaLabel="Filtered chart" onReady={latestReady} />);
  await load();
  expect(mock.instance.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [{ data: [7, 9] }] }), { notMerge: true });
  expect(initialReady).not.toHaveBeenCalled();
  expect(latestReady).toHaveBeenCalledWith(mock.instance);
});

it("routes chart clicks to the current selection callback without recreating the chart", async () => {
  const initialClick = vi.fn();
  const latestClick = vi.fn();
  const view = render(<EChart option={{}} ariaLabel="Chart" onEvents={{ click: initialClick }} />);
  await load();
  view.rerender(<EChart option={{}} ariaLabel="Chart" onEvents={{ click: latestClick }} />);
  mock.instance.on.mock.calls.find(([name]) => name === "click")![1]({ dataIndex: 2 });
  expect(initialClick).not.toHaveBeenCalled();
  expect(latestClick).toHaveBeenCalledWith({ dataIndex: 2 }, mock.instance);
  expect(mock.init).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mock.instance.dispose).toHaveBeenCalledTimes(1);
});

it("does not initialize a chart after its view was closed during lazy loading", async () => {
  const view = render(<EChart option={{}} ariaLabel="Chart" />);
  view.unmount();
  await load();
  expect(mock.init).not.toHaveBeenCalled();
});
