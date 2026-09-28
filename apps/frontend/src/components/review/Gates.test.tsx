import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";

it("names legacy diagnostics and inclusive thresholds without changing gate states", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", () => HttpResponse.json({
    runId: "run_41", caseNoun: "purchase order items", cases: 10,
    gates: [
      { id: "censoring", kind: "censoring", status: "pending", text: "Not flagged does not mean closed.",
        evidence: { share: 0.2, warnAt: 0.2, failAt: 0.4 } },
      { id: "replication", kind: "replication", status: "passed", text: "More than two events per distinct timestamp is not proof of copies.",
        evidence: { share: 0, warnAt: 0.2, failAt: 0.5 } },
    ],
  })));
  const key = encodeURIComponent('["companyID_0000","Packaging"]');
  renderApp(`/p/p2p2018/runs/run_41/slices/${key}/act?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation`);
  const censoring = await screen.findByTestId("gate-censoring", {}, { timeout: 8000 });
  expect(censoring).toHaveTextContent("recent-unclosed diagnostic (legacy)");
  expect(censoring).toHaveTextContent("20% of assessed cases, warning at or above 20%, failure at or above 40%");
  expect(censoring).toHaveAttribute("data-gate-status", "pending");
  const concentration = screen.getByTestId("gate-replication");
  expect(concentration).toHaveTextContent("event concentration per timestamp (legacy)");
  expect(concentration).toHaveTextContent("0% of assessed cases");
  expect(concentration).toHaveAttribute("data-gate-status", "passed");
});
