import type { Run } from "@wise/api-schema";

/** Slicing ids are the backend's: the case attributes (column names) joined by `+`. */
export const slicings = [
  { id: "case Company+case Spend area text", attributes: ["case Company", "case Spend area text"] },
  { id: "case Vendor", attributes: ["case Vendor"] },
  { id: "case Item Type", attributes: ["case Item Type"] },
  { id: "flow_type", attributes: ["flow_type"] },
];
export const views = ["Finance", "Logistics", "Compliance", "Automation"];

const base = {
  caseTableId: "ct_1",
  normVersionId: "nv_7",
  views,
  slicings,
  gamma: 20,
  minCases: 1,
};

const manifest = (paramsHash: string, startedAt: string, finishedAt: string) => ({
  normFingerprint: "9f3c0d2a4e6b8c1f9f3c0d2a4e6b8c1f9f3c0d2a4e6b8c1f9f3c0d2a4e6b8c1f",
  contentHash: "51ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b6451ab9d7c3e0f2b64",
  mappingId: "map_2",
  paramsHash,
  wiseVersion: "0.1.0",
  workbenchVersion: "0.1.0-mock",
  startedAt,
  finishedAt,
  views,
  slicings,
});

export const runs: Run[] = [
  { ...base, id: "run_38", status: "done", jobId: "job_38", note: "2018-H1", paramsHash: "a1f0", createdAt: "2026-07-02T09:01:00Z", manifest: manifest("a1f0", "2026-07-02T09:01:12Z", "2026-07-02T09:02:31Z") },
  { ...base, id: "run_39", status: "done", jobId: "job_39", note: "2018-H2", baselineRunId: "run_38", paramsHash: "b2e1", createdAt: "2026-07-02T09:05:00Z", manifest: manifest("b2e1", "2026-07-02T09:05:40Z", "2026-07-02T09:07:02Z") },
  { ...base, id: "run_40", status: "failed", jobId: "job_40", note: "2018 (γ = 200 sensitivity)", gamma: 200, paramsHash: "c3d2", createdAt: "2026-08-12T15:20:00Z", error: "gamma_out_of_range", manifest: manifest("c3d2", "2026-08-12T15:20:00Z", "2026-08-12T15:20:09Z") },
  { ...base, id: "run_41", status: "done", jobId: "job_41", note: "2018", paramsHash: "d4c3", createdAt: "2026-08-30T17:10:00Z", manifest: manifest("d4c3", "2026-08-30T17:10:05Z", "2026-08-30T17:11:29Z") },
];
