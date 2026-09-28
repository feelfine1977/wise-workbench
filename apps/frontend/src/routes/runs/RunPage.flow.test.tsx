import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";
import captured from "./fixtures/o2c-run.json";
import graph from "@/components/flow/fixtures/o2c-observed.json";

vi.unmock("@/components/flow/FlowMap");

it("opens the flow preview with the reported O2C run and manifest (null scope)", async () => {
  server.use(
    http.get("*/api/v1/projects/p2p2018/runs/run_41", () => HttpResponse.json({ ...captured.run, id: "run_41", jobId: null })),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/flow", () => HttpResponse.json(graph)),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/manifest", () => HttpResponse.json(captured.manifest)),
  );
  renderApp("/p/p2p2018/runs/run_41?tab=flow");
  expect(await screen.findByRole("group", { name: "Recorded process · all flow types" }, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
});
