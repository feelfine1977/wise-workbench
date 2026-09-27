import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/mocks/node";
import { DecisionPane, type DecisionPaneProps } from "./DecisionPane";

const row: BacklogRow = { key: '["vendorID_0128"]', keys: { "case Vendor": "vendorID_0128" }, n_cases: 5254, mean_score: 0.662, gap: 0.18, stable_gap: 0.178, PI: 945.7, stable_PI: 936.8, rank: 1, hotspot_type: "reservoir", kind: "widespread", dominant_layer: "L3_timeliness_ageing", stability: "stable" };
const base: DecisionPaneProps = { projectId: "p", runId: "run_41", slicing: "vendor", view: "Finance", row, missed: "invoices cleared late" };
const endpoint = "*/api/v1/projects/p/findings";
const first = JSON.stringify({ and: [{ kind: "count", activity: "Change Quantity", min: 1 }] });
const second = JSON.stringify({ and: [{ kind: "count", activity: "Change Quantity", min: 2 }] });
let records: ReturnType<typeof record>[];
let posts: Record<string, unknown>[];

function record(body: Record<string, unknown>, id: string = String(records.length)) {
  return {
    ...body, id, projectId: "p", kind: "finding", createdAt: `2026-09-27T10:00:${id.padStart(2, "0")}Z`, updatedAt: `2026-09-27T10:00:${id.padStart(2, "0")}Z`,
    evidenceState: "recorded", evidenceContext: {
      version: 1, runId: body.runId, slicing: body.slicing, sliceKey: body.sliceKey, view: body.view,
      normVersionId: "norm-7", normFingerprint: "server-norm", manifestFingerprint: "server-manifest",
      filter: typeof body.filter === "string" ? JSON.parse(body.filter) : null,
      selectionState: body.filter ? "measured" : undefined, selectionFingerprint: body.filter ? "server-membership" : undefined,
    },
  };
}

beforeEach(() => {
  records = []; posts = [];
  server.use(
    http.get(endpoint, () => HttpResponse.json(records)),
    http.post(endpoint, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      posts.push(body);
      const saved = record(body); records.push(saved);
      return HttpResponse.json(saved, { status: 201 });
    }),
  );
});

function mount(props: Partial<DecisionPaneProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = (next: Partial<DecisionPaneProps>) => <QueryClientProvider client={client}><TooltipProvider><DecisionPane {...base} {...next} /></TooltipProvider></QueryClientProvider>;
  const result = render(ui(props));
  return { ...result, change: (next: Partial<DecisionPaneProps>) => result.rerender(ui(next)) };
}

async function write(note: string) {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText("note *")).toBeEnabled());
  await user.click(screen.getByRole("radio", { name: "Investigate" }));
  await user.type(screen.getByLabelText("note *"), note);
  return user;
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByTestId("decision-status")).toHaveTextContent("Saved on server"));
}

describe("server-persisted decision pane", () => {
  it("requires decision and override notes, saves the exact selection, and reloads from a fresh query client", async () => {
    const pane = mount({ filter: first });
    expect(screen.getByTestId("decision-reading")).toHaveTextContent(/Reading:.*widespread.*invoices cleared late/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const user = await write("Validate correction reasons");
    await user.type(screen.getByLabelText("owner"), "Procurement lead");
    await user.click(screen.getByText("Change the kind"));
    await user.click(screen.getByRole("radio", { name: /acute/ }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByLabelText("why override *"), "Verified concentrated defects");
    await save();
    expect(posts[0]).toMatchObject({ runId: "run_41", slicing: "vendor", sliceKey: row.key, view: "Finance", filter: first, status: "investigate", note: "Validate correction reasons", owner_role: "Procurement lead", hotspotType: "severity" });
    expect(posts[0]).not.toHaveProperty("evidenceContext");
    expect(posts[0]).not.toHaveProperty("normVersionId");
    expect(localStorage.getItem("wise.findings")).toBeNull();
    pane.unmount(); mount({ filter: first });
    await waitFor(() => expect(screen.getByLabelText("note *")).toHaveValue("Validate correction reasons"));
    expect(screen.getByLabelText("owner")).toHaveValue("Procurement lead");
    expect(screen.getByTestId("decision-status")).toHaveTextContent("Last saved on server");
  });

  it("keeps filters and perspectives separate and appends a revision without overwriting history", async () => {
    const pane = mount({ filter: first });
    await write("First selection"); await save();
    pane.change({ filter: second });
    await write("Second selection"); await save();
    pane.change({ filter: first, view: "Service" });
    await write("Service perspective"); await save();
    pane.change({ filter: first });
    await waitFor(() => expect(screen.getByLabelText("note *")).toHaveValue("First selection"));
    await userEvent.clear(screen.getByLabelText("note *"));
    await userEvent.type(screen.getByLabelText("note *"), "Revised first selection");
    await save();
    expect(records).toHaveLength(4);
    expect(records[0]).toHaveProperty("note", "First selection");
    pane.unmount(); mount({ filter: first });
    await waitFor(() => expect(screen.getByLabelText("note *")).toHaveValue("Revised first selection"));
  });

  it("shows load failure, disables saving and retries without falling back to browser data", async () => {
    localStorage.setItem("wise.findings", JSON.stringify({ state: { findings: { legacy: { dispositionNote: "Wrong local finding" } } } }));
    server.use(http.get(endpoint, () => HttpResponse.json({ detail: "Database unavailable" }, { status: 503 })));
    mount({ filter: first });
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByLabelText("note *")).toHaveValue("");
    server.use(http.get(endpoint, () => HttpResponse.json([])));
    await userEvent.click(screen.getByRole("button", { name: "Reload findings" }));
    await write("After reconnect"); await save();
    expect(posts[0]).toHaveProperty("filter", first);
  });

  it("shows save errors and rejects a legacy successful response without server-owned evidence", async () => {
    server.use(http.post(endpoint, () => HttpResponse.json({ detail: "Evidence no longer available" }, { status: 409 })));
    mount({ filter: first });
    await write("Keep my draft");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Evidence no longer available");
    expect(screen.getByLabelText("note *")).toHaveValue("Keep my draft");
    expect(screen.getByTestId("decision-status")).not.toHaveTextContent("Saved on server");
    server.use(http.post(endpoint, () => HttpResponse.json({ id: "legacy", projectId: "p", kind: "finding" }, { status: 201 })));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("exact evidence scope"));
    expect(localStorage.getItem("wise.findings")).toBeNull();
  });

  it("retains malformed filter input for server validation", async () => {
    server.use(http.post(endpoint, async ({ request }) => {
      posts.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ detail: "Filter is not valid JSON" }, { status: 422 });
    }));
    mount({ filter: "" }); await write("Check selection");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Filter is not valid JSON");
    expect(posts[0]).toHaveProperty("filter", "");
  });

  it.each([{ within: "vendor" }, { view: undefined }])("does not silently save a broader/default scope for %j", async (props) => {
    mount(props);
    expect(await screen.findByRole("alert")).toHaveTextContent(/drilled selection|Choose a perspective/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  it("discloses a preserved but unmeasured selection", async () => {
    const saved = record({ ...base, sliceKey: row.key, status: "investigate", filter: first, note: "Needs data" });
    Object.assign(saved.evidenceContext, { selectionState: "unavailable", selectionReason: "No matching items", selectionFingerprint: null });
    records.push(saved);
    mount({ filter: first });
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved selection is not measured: No matching items");
  });

  it("uses the server's grouping query and accepts its canonical slicing identity", async () => {
    const reads: URLSearchParams[] = [];
    const saved = record({ ...base, sliceKey: row.key, status: "investigate", note: "Canonical group" });
    server.use(http.get(endpoint, ({ request }) => {
      reads.push(new URL(request.url).searchParams);
      return HttpResponse.json([saved]);
    }));
    mount({ slicing: "case Vendor" });
    await waitFor(() => expect(screen.getByLabelText("note *")).toHaveValue("Canonical group"));
    expect(reads[0]?.get("slicing")).toBe("case Vendor");
    expect(reads[0]?.get("key")).toBe(row.key);
    expect(reads[0]?.get("runId")).toBe(base.runId);
  });

  it("keeps an unmeasured save visible instead of letting the parent close the editor", async () => {
    server.use(http.post(endpoint, async ({ request }) => {
      const saved = record(await request.json() as Record<string, unknown>);
      Object.assign(saved.evidenceContext, { selectionState: "unavailable", selectionReason: "This selection cannot be measured", selectionFingerprint: null });
      records.push(saved);
      return HttpResponse.json(saved, { status: 201 });
    }));
    const onSaved = vi.fn();
    mount({ filter: first, onSaved });
    await write("Record evidence gap"); await save();
    expect(screen.getByRole("alert")).toHaveTextContent("This selection cannot be measured");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not move a pending save's draft or success callback into a different selection", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(endpoint, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      posts.push(body); await pending;
      const saved = record(body); records.push(saved);
      return HttpResponse.json(saved, { status: 201 });
    }));
    const onSaved = vi.fn();
    const pane = mount({ filter: first, onSaved });
    await write("First only");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    pane.change({ filter: second, onSaved });
    release();
    await waitFor(() => expect(records).toHaveLength(1));
    expect(screen.getByLabelText("note *")).toHaveValue("");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("decision-status")).not.toHaveTextContent("Saved on server");
  });
});
