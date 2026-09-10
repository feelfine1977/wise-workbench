import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import type { ReviewItem } from "@/lib/api/review";
import type { Filter } from "@/lib/api/filter-types";
import { buildBacklog } from "@/mocks/fixtures/backlog";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const SLICING_ID = "case Company+case Spend area text";
const SLICING = encodeURIComponent(SLICING_ID);
const KEY = encodeURIComponent('["companyID_0000", "Packaging"]');
const PATH = `/p/p2p2018/runs/run_41/slices/${KEY}/act?slicing=${SLICING}&view=Automation`;
const ACTIONS_API = "*/api/v1/projects/p2p2018/actions";
const GATES_API = "*/api/v1/projects/p2p2018/runs/run_41/gates";
const EVIDENCE_CONTEXT = {
  version: 1 as const,
  runId: "saved-run-id",
  normVersionId: "saved-norm-id",
  normFingerprint: "saved-norm-fingerprint",
  caseTableId: "saved-case-table-id",
  contentHash: "saved-content-hash",
  paramsHash: "saved-params-hash",
  manifestFingerprint: "saved-manifest-fingerprint",
  view: "Automation",
  slicing: SLICING_ID,
  sliceKey: JSON.stringify(JSON.parse(decodeURIComponent(KEY)) as unknown),
  filter: null,
  flowScope: null,
  scenario: null,
  comparator: { kind: "run_population" as const, view: "Automation" },
  populationCases: 120,
} satisfies NonNullable<ReviewItem["evidenceContext"]>;

function savedAction(body: Record<string, unknown>): ReviewItem {
  return {
    ...body,
    id: "saved-action",
    projectId: "p2p2018",
    kind: "action",
    status: "proposed",
    title: String(body.title),
    sliceKey: typeof body.sliceKey === "string" ? JSON.stringify(JSON.parse(body.sliceKey) as unknown) : undefined,
    createdAt: "2026-09-10T10:00:00Z",
    updatedAt: "2026-09-10T10:00:00Z",
  };
}

describe("Action proposals", () => {
  it.each(["", "{", '{"and":[{"kind":"open","value":true},null]}', "7"])("retains invalid filter %s in every refused proposal request", async (filter) => {
    const submitted: Record<string, unknown>[] = [];
    server.use(http.post(ACTIONS_API, async ({ request }) => {
      submitted.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ status: 422, detail: "The filter is invalid. Correct the selection before saving.", code: "filter.shape" }, { status: 422 });
    }));
    const user = userEvent.setup();
    renderApp(`${PATH}&filter=${encodeURIComponent(filter)}`);
    await screen.findAllByTestId("driver-card", {}, T);
    expect(screen.getByTestId("act-selection-notice")).toHaveTextContent("Suggestions below describe the whole group.");
    await user.click(screen.getByRole("button", { name: "Propose an action of your own" }));
    const form = await screen.findByRole("form", { name: "Propose an action" }, T);
    const fields = within(form);
    await user.type(fields.getByLabelText("What should be done"), "Keep this draft");
    await user.type(fields.getByLabelText("Who owns it"), "Owner");
    await user.type(fields.getByLabelText("Who is proposing it"), "Reviewer");
    await user.type(fields.getByLabelText("A note (optional)"), "Keep this note");
    await user.click(fields.getByRole("button", { name: "Save the proposal" }));
    expect(await fields.findByRole("alert")).toHaveTextContent("The filter is invalid.");
    expect(fields.getByLabelText("What should be done")).toHaveValue("Keep this draft");
    expect(fields.getByLabelText("A note (optional)")).toHaveValue("Keep this note");
    await user.click(fields.getByRole("button", { name: "Retry saving the proposal" }));
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted.map((body) => body.filter)).toEqual([filter, filter]);
    expect(submitted.every((body) => body.status === "proposed")).toBe(true);
    expect(screen.getByTestId("open-findings")).not.toHaveTextContent("Keep this draft");
  });

  it("sends unsupported drilled context intact and retains the draft after explicit refusal", async () => {
    const parent = '{"slicing":"company","key":"[\\"A\\"]"}';
    const filter = '{"and":[{"kind":"open","value":true}]}';
    const submitted: Record<string, unknown>[] = [];
    server.use(http.post(ACTIONS_API, async ({ request }) => {
      submitted.push(await request.json() as Record<string, unknown>);
      return HttpResponse.json({ status: 422, code: "review.immutable_context", detail: "Proposals for drilled selections are not supported yet." }, { status: 422 });
    }));
    const user = userEvent.setup();
    renderApp(`${PATH}&within=${encodeURIComponent(parent)}&filter=${encodeURIComponent(filter)}`);
    const driver = (await screen.findAllByTestId("driver-card", {}, T))[0]!;
    expect(screen.getByTestId("act-selection-notice")).toHaveTextContent("saving is refused until its parent group can be recorded");
    await user.click(within(driver).getAllByRole("button", { name: "Propose this action" })[0]!);
    const form = await screen.findByRole("form", { name: "Propose an action" }, T);
    expect(form).toHaveTextContent("whole-group evidence cannot replace it");
    const fields = within(form);
    const title = (fields.getByLabelText("What should be done") as HTMLTextAreaElement).value;
    await user.type(fields.getByLabelText("Who is proposing it"), "Reviewer");
    await user.click(fields.getByRole("button", { name: "Save the proposal" }));
    expect(await fields.findByRole("alert")).toHaveTextContent("Proposals for drilled selections are not supported yet.");
    expect(fields.getByLabelText("What should be done")).toHaveValue(title);
    expect(fields.getByLabelText("Who is proposing it")).toHaveValue("Reviewer");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ within: parent, filter, status: "proposed" });
    const back = screen.getByRole("link", { name: /Back to why this group is worst/ });
    const query = new URL(back.getAttribute("href")!, "http://localhost").searchParams;
    expect(query.get("filter")).toBe(filter);
    expect(query.get("within")).toBe(parent);
  });

  it("records a run-wide waiver with a rationale through the existing gate endpoint", async () => {
    let status = "failed";
    let note: string | undefined;
    let requestBody: Record<string, unknown> | undefined;
    let requestParams: Record<string, string> | undefined;
    const gates = () => ({ gates: [
      { id: "readiness", kind: "readiness", status: "passed", scope: "group", text: "This group's checks passed." },
      { id: "run_readiness", kind: "readiness", status, scope: "run", text: "The log-wide drift check needs a decision.", note, author: "Reviewer" },
    ] });
    server.use(
      http.get(GATES_API, () => HttpResponse.json(gates())),
      http.post(`${GATES_API}/run_readiness`, async ({ request }) => {
        requestParams = Object.fromEntries(new URL(request.url).searchParams);
        requestBody = await request.json() as Record<string, unknown>;
        status = String(requestBody.status);
        note = String(requestBody.note);
        return HttpResponse.json(gates());
      }),
    );
    const user = userEvent.setup();
    renderApp(PATH);
    const row = await screen.findByTestId("gate-run_readiness", {}, T);
    expect(row).toHaveTextContent("one reading for the whole run");
    expect(screen.getByTestId("gate-readiness")).not.toHaveTextContent("one reading for the whole run");
    await user.click(within(row).getByRole("button", { name: "Change" }));
    expect(row).toHaveTextContent("This decision applies to the whole run.");
    const record = within(row).getByRole("button", { name: "Record this reading" });
    expect(record).toBeDisabled();
    await user.click(within(row).getByLabelText("Waive it, with a reason"));
    await user.type(within(row).getByLabelText("Why (required)"), "Reviewed the drift across the run");
    await user.type(within(row).getByLabelText("Who decided (required)"), "Reviewer");
    await user.click(record);
    await waitFor(() => expect(row).toHaveAttribute("data-gate-status", "waived"), T);
    expect(requestBody).toEqual({ status: "waived", note: "Reviewed the drift across the run", author: "Reviewer" });
    expect(requestParams).toEqual({ slicing: SLICING_ID, key: decodeURIComponent(KEY), view: "Automation" });
    expect(within(row).getByTestId("gate-note-run_readiness")).toHaveTextContent("Reviewed the drift across the run");
  });

  it.each([
    { failure: "conflict", status: 409, detail: "The selected evidence is no longer available. Choose the group again." },
    { failure: "validation", status: 422, detail: "The owner role must be provided for this proposal." },
    { failure: "empty problem", status: 422, detail: undefined },
    { failure: "network", status: undefined, detail: undefined },
  ])("keeps typed fields and offers keyboard retry at the triggering form after $failure", async ({ status, detail }) => {
    const submitted: Record<string, unknown>[] = [];
    const records: ReviewItem[] = [];
    server.use(
      http.get(ACTIONS_API, () => HttpResponse.json(records)),
      http.post(ACTIONS_API, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        submitted.push(body);
        if (submitted.length === 1) {
          return status ? HttpResponse.json({ type: "about:blank", status, title: "Request refused", detail }, { status, headers: { "Content-Type": "application/problem+json" } }) : HttpResponse.error();
        }
        const action = savedAction({ ...body, evidenceState: "recorded", evidenceContext: EVIDENCE_CONTEXT });
        records.push(action);
        return HttpResponse.json(action, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(PATH);
    const driver = (await screen.findAllByTestId("driver-card", {}, T))[0]!;
    await user.click(within(driver).getAllByRole("button", { name: "Propose this action" })[0]!);
    const form = await screen.findByRole("form", { name: "Propose an action" }, T);
    const fields = within(form);
    await user.clear(fields.getByLabelText("What should be done"));
    await user.type(fields.getByLabelText("What should be done"), "Review payment controls");
    await user.selectOptions(fields.getByLabelText("What kind of countermeasure"), "standard_work");
    await user.clear(fields.getByLabelText("Who owns it"));
    await user.type(fields.getByLabelText("Who owns it"), "finance lead");
    await user.type(fields.getByLabelText("A note (optional)"), "Keep the selected evidence");
    await user.type(fields.getByLabelText("Who is proposing it"), "process owner");
    await user.click(fields.getByRole("button", { name: "Save the proposal" }));

    const alert = await fields.findByRole("alert");
    expect(driver).toContainElement(alert);
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent(detail ?? (status ? "Review the proposal and try again." : "The save could not be confirmed."));
    expect(alert).not.toHaveTextContent(/nothing was recorded|Request refused|409|422/);
    expect(fields.getByLabelText("What should be done")).toHaveValue("Review payment controls");
    expect(fields.getByLabelText("What kind of countermeasure")).toHaveValue("standard_work");
    expect(fields.getByLabelText("Who owns it")).toHaveValue("finance lead");
    expect(fields.getByLabelText("A note (optional)")).toHaveValue("Keep the selected evidence");
    expect(fields.getByLabelText("Who is proposing it")).toHaveValue("process owner");
    expect(screen.getByTestId("open-findings")).not.toHaveTextContent("Review payment controls");
    const retry = fields.getByRole("button", { name: "Retry saving the proposal" });
    expect(retry).toBeEnabled();
    expect(retry).toHaveAccessibleDescription(alert.textContent!);
    await expectNoSeriousA11yViolations(form);
    await user.tab();
    expect(retry).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByTestId("action-form")).not.toBeInTheDocument(), T);
    expect(await within(screen.getByTestId("open-findings")).findByText("Review payment controls", { exact: false }, T)).toBeInTheDocument();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[1]).toMatchObject({ status: "proposed", runId: "run_41", slicing: SLICING_ID, sliceKey: decodeURIComponent(KEY), view: "Automation", links: ["c_l3_invoice_to_clear_days"] });
    expect(submitted[1]).not.toHaveProperty("evidenceContext");
    expect(submitted[1]).not.toHaveProperty("filter");
    expect(within(screen.getByTestId("open-findings")).getByTestId("action-evidence")).toHaveTextContent("Evidence scope recorded.");
  });

  it.each(["pending", "failed"] as const)("sends the complete URL filter for server validation while a gate is %s", async (status) => {
    const submitted: Record<string, unknown>[] = [];
    const records: ReviewItem[] = [];
    server.use(
      http.get(GATES_API, ({ request }) => HttpResponse.json({ filter: JSON.parse(new URL(request.url).searchParams.get("filter")!), selection: { state: "measured", cases: 12, wholeGroupCases: 120, fingerprint: "selected-cases" }, gates: [{ id: "selection-check", kind: "domain", status, text: "Review the selected group." }] })),
      http.get(ACTIONS_API, () => HttpResponse.json(records)),
      http.post(ACTIONS_API, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        submitted.push(body);
        const action = savedAction({ ...body, evidenceState: "recorded", evidenceContext: { ...EVIDENCE_CONTEXT, filter: JSON.parse(String(body.filter)), populationCases: 12, selectionState: "measured", selectionFingerprint: "selected-cases" } });
        records.push(action);
        return HttpResponse.json(action, { status: 201 });
      }),
    );
    const filter: Filter = { and: [
      { kind: "open", value: true },
      { kind: "attribute", field: "case Company", in: ["B", "A"] },
      { kind: "activity", activity: "Invoice", op: "not_contains" },
      { kind: "open", value: true },
    ] };
    const user = userEvent.setup();
    renderApp(`${PATH}&filter=${encodeURIComponent(JSON.stringify(filter))}`);
    await screen.findAllByTestId("driver-card", {}, T);
    expect(await screen.findByTestId("gate-selection-check", {}, T)).toHaveAttribute("data-gate-status", status);
    await user.click(screen.getByRole("button", { name: "Propose an action of your own" }));
    const form = await screen.findByRole("form", { name: "Propose an action" }, T);
    expect(form).toHaveTextContent("Acceptance is a separate decision");
    expect(form).toHaveTextContent("The filter in this address is sent for validation.");
    const fields = within(form);
    await user.type(fields.getByLabelText("What should be done"), "Review the filtered selection");
    await user.type(fields.getByLabelText("Who owns it"), "finance lead");
    await user.type(fields.getByLabelText("Who is proposing it"), "process owner");
    expect(fields.getByRole("button", { name: "Save the proposal" })).toBeEnabled();
    await user.click(fields.getByRole("button", { name: "Save the proposal" }));

    expect(await within(screen.getByTestId("open-findings")).findByText("Review the filtered selection", { exact: false }, T)).toBeInTheDocument();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ status: "proposed", runId: "run_41", slicing: SLICING_ID, sliceKey: decodeURIComponent(KEY), view: "Automation", links: [] });
    expect(submitted[0]?.filter).toBe(JSON.stringify(filter));
    expect(submitted[0]).not.toHaveProperty("evidenceContext");
    expect(screen.getByTestId("gate-selection-check")).toHaveAttribute("data-gate-status", status);
    expect(within(screen.getByTestId("open-findings")).getByTestId("action-evidence")).toHaveTextContent("Evidence scope recorded with a filter. Selected purchase order items measured: 12.");
  });

  it("keeps an unsupported UI filter in a proposal without offering selected decisions or acceptance", async () => {
    const filter: Filter = { and: [{ kind: "constraint", constraint: "c_l3_invoice_to_clear_days", state: "violating" }] };
    const rawFilter = JSON.stringify(filter);
    const submitted: Record<string, unknown>[] = [];
    const records: ReviewItem[] = [];
    server.use(
      http.get(GATES_API, () => HttpResponse.json({ detail: "This filter cannot be measured by the current engine.", code: "review.filter_unsupported" }, { status: 422 })),
      http.get(ACTIONS_API, () => HttpResponse.json(records)),
      http.post(ACTIONS_API, async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        submitted.push(body);
        const action = savedAction({ ...body, evidenceState: "recorded", evidenceContext: { ...EVIDENCE_CONTEXT, filter, populationCases: null, selectionState: "unavailable", selectionReason: "This filter cannot be measured by the current engine." } });
        records.push(action);
        return HttpResponse.json(action, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`${PATH}&filter=${encodeURIComponent(rawFilter)}`);
    const unavailable = await screen.findByTestId("gates-unavailable", {}, T);
    expect(unavailable).toHaveTextContent("This filter cannot be measured by the current engine.");
    await user.click(await screen.findByRole("button", { name: "Propose an action of your own" }, T));
    const form = await screen.findByTestId("action-form", {}, T);
    expect(form).toHaveTextContent("unsupported filter variants may be kept in a proposal but cannot be accepted");
    const fields = within(form);
    await user.type(fields.getByLabelText("What should be done"), "Review this unsupported scope");
    await user.type(fields.getByLabelText("Who owns it"), "Owner");
    await user.type(fields.getByLabelText("Who is proposing it"), "Reviewer");
    await user.click(fields.getByRole("button", { name: "Save the proposal" }));
    const findings = screen.getByTestId("open-findings");
    const assessment = await within(findings).findByTestId("action-evidence", {}, T);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ filter: rawFilter, status: "proposed" });
    expect(submitted[0]).not.toHaveProperty("evidenceContext");
    expect(assessment).toHaveTextContent("Acceptance is unavailable until checks can be measured for that exact selection.");
    expect(assessment).not.toHaveTextContent(/120|selected cases measured/);
    expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
    expect(within(findings).queryByRole("button", { name: /accept|agree|start|complete/i })).not.toBeInTheDocument();
  });

  it.each([
    { label: "recorded scope", evidenceState: "recorded", evidenceContext: EVIDENCE_CONTEXT, expected: "Evidence scope recorded. Acceptance still requires available, unchanged evidence and current checks that have passed or been waived." },
    { label: "filtered scope", evidenceState: "recorded", evidenceContext: { ...EVIDENCE_CONTEXT, filter: { and: [{ kind: "open", value: true }] }, populationCases: null }, expected: "Evidence scope recorded with a filter. Acceptance is unavailable until checks can be measured for that exact selection." },
    { label: "measured filtered scope", evidenceState: "recorded", evidenceContext: { ...EVIDENCE_CONTEXT, filter: { and: [{ kind: "open", value: true }] }, populationCases: 1, selectionState: "measured", selectionFingerprint: "saved-selection-fingerprint" }, expected: "Evidence scope recorded with a filter. Selected purchase order items measured: 1. Acceptance still requires available, unchanged evidence and current checks that have passed or been waived." },
    { label: "unsupported filtered scope", evidenceState: "recorded", evidenceContext: { ...EVIDENCE_CONTEXT, filter: { and: [{ kind: "activity", op: "future_variant", activity: "Invoice" }] }, populationCases: null, selectionState: "unavailable", selectionReason: "This filter variant cannot be measured." }, expected: "Evidence scope recorded with a filter. Acceptance is unavailable until checks can be measured for that exact selection. This filter variant cannot be measured." },
    { label: "unassessed draft", evidenceState: "unassessed", evidenceContext: null, expected: "Evidence not assessed. Create a new proposal for the current group before acceptance." },
    { label: "legacy action with null context", evidenceState: null, evidenceContext: null, expected: "Evidence not assessed. Create a new proposal for the current group before acceptance." },
    { label: "legacy action with missing fields", evidenceState: undefined, evidenceContext: undefined, expected: "Evidence not assessed. Create a new proposal for the current group before acceptance." },
  ])("reads saved $label without exposing IDs or treating the last check as permission", async ({ evidenceState, evidenceContext, expected }) => {
    server.use(http.get(ACTIONS_API, () => HttpResponse.json([savedAction({
      title: "Review saved evidence",
      evidenceState,
      evidenceContext,
      commitmentCheck: { eligible: true, status: "passed", checkedAt: "2026-09-01T10:00:00Z", gateIds: ["internal-gate-id"] },
    })])));
    // The current URL intentionally differs from the saved scope in both directions.
    const currentFilter = evidenceContext?.filter ? "" : `&filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "open", value: true }] }))}`;
    renderApp(`${PATH}${currentFilter}`);
    const findings = await screen.findByTestId("open-findings", {}, T);
    const assessment = await within(findings).findByTestId("action-evidence", {}, T);
    expect(findings).toHaveTextContent("Review saved evidence");
    await waitFor(() => expect(assessment).toHaveTextContent(expected), T);
    expect(findings).not.toHaveTextContent(/saved-run-id|saved-norm|saved-case-table-id|saved-content-hash|saved-params-hash|saved-manifest-fingerprint|saved-selection-fingerprint|internal-gate-id|run_population/);
    expect(assessment).not.toHaveTextContent(/eligible|approved|ready for acceptance/i);
    expect(within(findings).queryByRole("button", { name: /accept|agree|start|complete/i })).not.toBeInTheDocument();
  });

  it("shows the saved group after its key is normalized without including another group's actions", async () => {
    server.use(http.get(ACTIONS_API, () => HttpResponse.json([
      savedAction({ title: "This group's proposal", sliceKey: decodeURIComponent(KEY), evidenceState: "recorded", evidenceContext: EVIDENCE_CONTEXT }),
      { ...savedAction({ title: "Another group's proposal", sliceKey: '["companyID_0000", "Other group"]' }), id: "other-action" },
    ])));
    renderApp(PATH);
    const findings = await screen.findByTestId("open-findings", {}, T);
    expect(await within(findings).findByText("This group's proposal", { exact: false }, T)).toBeInTheDocument();
    expect(findings).not.toHaveTextContent("Another group's proposal");
  });

  it("scopes both Open findings lists by run, grouping and key when different groupings share the same key", async () => {
    const requests: { collection: string; params: Record<string, string> }[] = [];
    for (const collection of ["actions", "hypotheses"] as const) {
      server.use(http.get(`*/api/v1/projects/p2p2018/${collection}`, ({ request }) => {
        const params = Object.fromEntries(new URL(request.url).searchParams);
        requests.push({ collection, params });
        const records = [SLICING_ID, "case Region+case Category"].map((slicing, i) => ({
          ...savedAction({ title: `${i === 0 ? "Selected" : "Other"} grouping ${collection}`, runId: "run_41", slicing, sliceKey: decodeURIComponent(KEY) }),
          id: `${collection}-${i}`,
          kind: collection === "actions" ? "action" : "hypothesis",
        }));
        return HttpResponse.json(records.filter((record) =>
          (!params.runId || record.runId === params.runId) &&
          (!params.slicing || record.slicing === params.slicing) &&
          (!params.key || record.sliceKey === JSON.stringify(JSON.parse(params.key) as unknown)),
        ));
      }));
    }
    renderApp(PATH);
    const findings = await screen.findByTestId("open-findings", {}, T);
    expect(await within(findings).findByText("Selected grouping actions", { exact: false }, T)).toBeInTheDocument();
    expect(await within(findings).findByText("Selected grouping hypotheses", { exact: false }, T)).toBeInTheDocument();
    expect(findings).not.toHaveTextContent("Other grouping");
    for (const collection of ["actions", "hypotheses"]) {
      expect(requests).toContainEqual({ collection, params: { runId: "run_41", slicing: SLICING_ID, key: decodeURIComponent(KEY) } });
    }
  });
});

describe("What can we do? — the seventh step (R3-01)", () => {
  it("lists the drivers with their headroom, their reasons split in and outside the log, and their actions with an owner role", async () => {
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    expect(cards.length).toBeGreaterThanOrEqual(3);

    const first = cards[0] as HTMLElement;
    // the expectation in plain words, never its id
    expect(first).toHaveTextContent(/Paid within terms/);
    expect(first.textContent).not.toMatch(/c_l3_invoice_to_clear_days/);
    // the share of the shortfall and the headroom in score points
    expect(within(first).getByTestId("driver-reading")).toHaveTextContent(/93\s?% of the shortfall/);
    expect(within(first).getByTestId("headroom")).toHaveTextContent(/4\.3\d? points of possible gain/);
    // the reasons say what the log can show and whom to ask when it cannot
    const reasons = within(first).getByTestId("driver-reasons");
    expect(reasons).toHaveTextContent(/in the log — check/);
    expect(reasons).toHaveTextContent(/outside the log — ask/);
    // the actions carry a countermeasure type and a role
    expect(within(first).getAllByTestId("action-owner")[0]).toHaveTextContent(/measurement · finance controlling/);
    // what to check first
    expect(first).toHaveTextContent(/What to check first/);
    // every driver carries a chip that opens its hub page
    expect(within(first).getAllByTestId("what-does-this-mean").length).toBeGreaterThan(0);
  });

  it("refuses a hypothesis while a check on this group has no reading, and records it once the check is waived", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findAllByTestId("driver-card", {}, T);

    // Packaging's censoring share is 14 %: below the warning, so no check of this group blocks
    await screen.findByTestId("hypothesis-form", {}, T);
    await waitFor(() => expect(screen.queryByTestId("hypothesis-blocked")).not.toBeInTheDocument(), T);

    // A run-wide reading remains identified as such and can be decided from this screen.
    const readiness = await screen.findByTestId("gate-readiness", {}, T);
    expect(readiness).toHaveTextContent(/one reading for the whole run/);
    expect(within(readiness).getByRole("button", { name: /Decide|Change/ })).toBeInTheDocument();

    // marking a reason to test fills the statement and names its expectation
    await user.click(within(screen.getAllByTestId("driver-card")[0] as HTMLElement).getAllByRole("button", { name: "Mark to test" })[0] as HTMLElement);
    await waitFor(() => expect((within(screen.getByTestId("hypothesis-form")).getByLabelText(/your own words/) as HTMLTextAreaElement).value).toMatch(/Contractual terms/), T);

    // the form is rebuilt around the marked reason, so it is looked up again here
    const form = screen.getByTestId("hypothesis-form");
    await user.type(within(form).getByLabelText(/Who is recording it/), "SD expert");
    await user.click(within(form).getByRole("button", { name: /Record the hypothesis/ }));
    // the record survives on the server and lists under Open findings
    expect(await within(await screen.findByTestId("open-findings", {}, T)).findByText(/Contractual terms/, {}, T)).toBeInTheDocument();
  });

  it("saves a proposed action with its owner role under Open findings, in a form that opens where it was asked for", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    await user.click(within(cards[0] as HTMLElement).getAllByRole("button", { name: "Propose this action" })[0] as HTMLElement);
    const form = await screen.findByTestId("action-form", {}, T);
    // P1-7: the form is inside the driver whose action was pressed, not at the foot of the page 1,952 px below
    expect((cards[0] as HTMLElement).contains(form)).toBe(true);
    expect(document.activeElement).toBe(within(form).getByLabelText(/What should be done/));
    expect((within(form).getByLabelText(/What should be done/) as HTMLTextAreaElement).value).toMatch(/Payment terms per vendor/);
    await user.type(within(form).getByLabelText(/Who is proposing it/), "process owner");
    await user.click(within(form).getByRole("button", { name: /Save the proposal/ }));
    const findings = await screen.findByTestId("open-findings", {}, T);
    expect(await within(findings).findByText(/Payment terms per vendor/, {}, T)).toBeInTheDocument();
    expect(findings).toHaveTextContent(/finance controlling/);
  });

  it("puts what was proposed on the dashboard, from the server rather than from this browser (P1-6)", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    await user.click(within(cards[0] as HTMLElement).getAllByRole("button", { name: "Propose this action" })[0] as HTMLElement);
    const form = await screen.findByTestId("action-form", {}, T);
    await user.type(within(form).getByLabelText(/Who is proposing it/), "process owner");
    await user.click(within(form).getByRole("button", { name: /Save the proposal/ }));
    await waitFor(() => expect(screen.getByTestId("open-findings")).toHaveTextContent(/Payment terms per vendor/), T);

    // the dashboard reads the same records: it read a browser-local list and said "No finding yet" while the
    // server held the action
    cleanup();
    renderApp("/p/p2p2018");
    const records = await screen.findByTestId("open-records", {}, T);
    expect(records).toHaveTextContent(/Payment terms per vendor/);
    expect(records).toHaveTextContent(/finance controlling/);
    expect(records).toHaveTextContent(/process owner/);
    expect(document.body.textContent ?? "").not.toMatch(/No finding yet/);
  });

  it("names a group that is ranked below the first page in words, not as its key", async () => {
    // the screen reads the names from the first page of the ranked list; a group below it used to fall back to
    // the key itself, so the heading read ["companyID_0003","Real Estate"]
    const { rows } = buildBacklog(SLICING_ID, "Automation", 20, 1);
    const ranked = [...rows].sort((a, b) => b.stable_PI - a.stable_PI);
    expect(ranked.length, "the mocked run has more than sixteen groups").toBeGreaterThan(15);
    const below = ranked[15]!;
    const values = Object.values(below.keys ?? {});
    renderApp(`/p/p2p2018/runs/run_41/slices/${encodeURIComponent(below.key)}/act?slicing=${SLICING}&view=Automation`);

    const heading = await screen.findByRole("heading", { level: 1 }, T);
    expect(heading).toHaveTextContent(values[values.length - 1] as string);
    expect(heading.textContent ?? "").not.toMatch(/[[\]"]/);
  });

  it("prints no status code, no raw id and no release name", async () => {
    renderApp(PATH);
    await screen.findAllByTestId("driver-card", {}, T);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b(404|422|500)\b/);
    expect(text).not.toMatch(/cycle \d|increment \d/i);
    expect(text).not.toMatch(/\bc_l\d_/);
    // a numeric group key never keeps a float tail (R3-08)
    expect(text).not.toMatch(/\b\d{3,}\.0\b/);
  });
});
