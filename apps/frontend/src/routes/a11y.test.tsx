import { screen } from "@testing-library/react";
import { describe, it } from "vitest";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const RUN = "/p/p2p2018/runs/run_41";
const VENDOR = encodeURIComponent("case Vendor");
const CSA = encodeURIComponent("case Company+case Spend area text");

describe("accessibility of the main screens (axe)", () => {
  it("project dashboard with the flow types", async () => {
    renderApp("/p/p2p2018");
    await screen.findByRole("heading", { level: 1, name: /P2P 2018/ }, T);
    await screen.findByTestId("top-signal", {}, T);
    await screen.findByRole("list", { name: "Flow types" }, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("data caveats with decisions", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=readiness");
    await screen.findByTestId("readiness-decisions", {}, T);
    await screen.findByText(/Data readiness/, {}, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("column mapping", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1&tab=mapping");
    await screen.findByText(/Column profiler/, {}, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("signals list", async () => {
    renderApp(`${RUN}/backlog?slicing=${VENDOR}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("metric table", async () => {
    renderApp(`${RUN}/backlog?slicing=${VENDOR}&view=Finance&tab=table`);
    await screen.findByRole("grid", { name: "Backlog" }, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("reason screen (Why?) on Packaging", async () => {
    renderApp(`${RUN}/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}?slicing=${CSA}&view=Automation&tab=why`);
    await screen.findByRole("heading", { name: "Decision" }, T);
    await screen.findByTestId("top-drivers", {}, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("flow types side by side", async () => {
    renderApp(`${RUN}?tab=compare`);
    await screen.findByTestId("compare-flow-types", {}, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("notebook", async () => {
    renderApp("/p/p2p2018/notebook");
    await screen.findByRole("heading", { level: 1, name: /^Notebook/ }, T);
    await expectNoSeriousA11yViolations(document.body);
  });
  it("norm version", async () => {
    renderApp("/p/p2p2018/norms/nv_7?tab=constraints");
    await screen.findByText(/Calibration lens/, {}, T);
    await expectNoSeriousA11yViolations(document.body);
  });
});
