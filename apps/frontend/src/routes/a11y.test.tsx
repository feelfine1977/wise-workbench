import { screen } from "@testing-library/react";
import { describe, it } from "vitest";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";

describe("accessibility of the main screens (axe)", () => {
  it("project dashboard", async () => {
    renderApp("/p/p2p2018");
    await screen.findByRole("heading", { level: 1, name: /P2P 2018/ }, { timeout: 8000 });
    await screen.findByText(/Open backlog explorer/, {}, { timeout: 8000 });
    await expectNoSeriousA11yViolations(document.body);
  });
  it("data and mapping", async () => {
    renderApp("/p/p2p2018/data/ds_1?caseTable=ct_1");
    await screen.findByText(/Column profiler/, {}, { timeout: 8000 });
    await screen.findByText(/Data readiness/, {}, { timeout: 8000 });
    await expectNoSeriousA11yViolations(document.body);
  });
  it("backlog explorer", async () => {
    renderApp("/p/p2p2018/runs/run_41/backlog?slicing=vendor&view=Finance");
    await screen.findByRole("grid", { name: "Backlog" }, { timeout: 8000 });
    await expectNoSeriousA11yViolations(document.body);
  });
  it("slice detail", async () => {
    renderApp("/p/p2p2018/runs/run_41/slices/vendorID_0128?slicing=vendor&view=Finance&tab=drivers");
    await screen.findByRole("heading", { name: "Decision" }, { timeout: 8000 });
    await screen.findByText(/Constraint drivers/, {}, { timeout: 8000 });
    await expectNoSeriousA11yViolations(document.body);
  });
  it("norm version", async () => {
    renderApp("/p/p2p2018/norms/nv_7?tab=constraints");
    await screen.findByText(/Calibration lens/, {}, { timeout: 8000 });
    await expectNoSeriousA11yViolations(document.body);
  });
});
