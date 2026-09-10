import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { gatesQuery, type Gates } from "@/lib/api/review";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const slicing = "case Company+case Spend area text";
const sliceKey = '["companyID_0000", "Packaging"]';
const scope = { slicing, sliceKey, view: "Automation" };
const path = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent(sliceKey)}/act?slicing=${encodeURIComponent(slicing)}&view=Automation`;
const gatesApi = "*/api/v1/projects/p2p2018/runs/run_41/gates";
const filter = '{"and":[{"kind":"open","value":true},{"kind":"open","value":true}]}';
const filteredPath = `${path}&filter=${encodeURIComponent(filter)}`;
const canonicalFilter = { and: [{ kind: "open", value: true }] };
const measured = {
  runId: "run_41", slicing, sliceKey, view: "Automation", caseNoun: "purchase order items",
  filter: canonicalFilter,
  selection: { state: "measured" as const, cases: 1, wholeGroupCases: 120, fingerprint: "internal-membership", decisionFingerprint: "internal-decision" },
  gates: [{ id: "selected", kind: "domain", scope: "group" as const, status: "pending" as const, text: "Readiness is unavailable for these selected cases." }],
} satisfies Gates;

it("shows measured membership with pending readiness, keeps suggestions whole-group, and withholds hypotheses after a filtered waiver", async () => {
  const reads: (string | null)[] = [];
  const posts: { filter: string | null; body: unknown }[] = [];
  const suggestionQueries: URLSearchParams[] = [];
  let waived = false;
  const answer = () => ({ ...measured, cases: 120, gates: measured.gates.map(g => ({ ...g, status: waived ? "waived" : "pending", note: waived ? "Reviewed selection" : undefined })) });
  server.use(
    http.get(gatesApi, ({ request }) => {
      reads.push(new URL(request.url).searchParams.get("filter"));
      return HttpResponse.json(answer());
    }),
    http.post(`${gatesApi}/selected`, async ({ request }) => {
      posts.push({ filter: new URL(request.url).searchParams.get("filter"), body: await request.json() });
      waived = true;
      return HttpResponse.json(answer());
    }),
    http.get("*/api/v1/projects/p2p2018/runs/run_41/what-can-we-do", ({ request }) => {
      suggestionQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ reading: "120 cases in this group.", caseNoun: "cases", drivers: [{ constraint_id: "expectation", plain_name: "Whole-group expectation", usual_reasons: [{ text: "Whole-group cause" }], usual_actions: [{ text: "Review the process", countermeasure: "review", owner_role: "Owner" }] }] });
    }),
  );
  const user = userEvent.setup();
  const { queryClient } = renderApp(filteredPath);
  const whole = gatesQuery("p2p2018", "run_41", scope);
  queryClient.setQueryDefaults(whole.queryKey, { gcTime: Infinity });
  queryClient.setQueryData(whole.queryKey, { ...measured, filter: undefined, selection: undefined, gates: [{ ...measured.gates[0]!, status: "failed" }] });
  const counts = await screen.findByTestId("gate-selection-counts", {}, T);
  expect(counts).toHaveTextContent("Selected purchase order items: 1 of 120 in the whole group. Checks use this exact selection.");
  expect(screen.getByTestId("act-gates")).toHaveTextContent("These checks describe the selected purchase order items.");
  expect(screen.getByTestId("act-reading")).toHaveTextContent("Whole group: 120 cases");
  expect(screen.getByTestId("whole-group-suggestions")).toHaveTextContent("Suggestions for the whole group");
  expect(screen.getByTestId("act-gates")).not.toHaveTextContent(/A hypothesis can be recorded|Every check.*has a reading|internal-membership|internal-decision/);
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark to test" })).not.toBeInTheDocument();
  const row = screen.getByTestId("gate-selected");
  expect(row).toHaveAttribute("data-gate-status", "pending");
  await user.click(within(row).getByRole("button", { name: "Decide" }));
  await user.type(within(row).getByLabelText("Why (required)"), "Reviewed selection");
  await user.type(within(row).getByLabelText("Who decided (required)"), "Reviewer");
  await user.click(within(row).getByRole("button", { name: "Record this reading" }));
  await waitFor(() => expect(row).toHaveAttribute("data-gate-status", "waived"), T);
  expect(posts).toEqual([{ filter, body: { status: "waived", note: "Reviewed selection", author: "Reviewer" } }]);
  expect(reads.length).toBeGreaterThan(1);
  expect(reads.every(value => value === filter)).toBe(true);
  expect(suggestionQueries.length).toBeGreaterThan(0);
  expect(suggestionQueries.every(params => !params.has("filter") && !params.has("within"))).toBe(true);
  expect(queryClient.getQueryData(whole.queryKey)).toMatchObject({ gates: [{ status: "failed" }] });
  expect(queryClient.getQueryState(whole.queryKey)?.isInvalidated).toBe(false);
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  expect(screen.getByTestId("hypothesis-selection-notice")).toHaveTextContent("Hypotheses use whole-group checks");
});

it.each([
  { status: 422, filter: '{"and":[{"kind":"activity","activity":"Invoice","op":"future_variant"}]}', detail: "This filter variant is not supported.", code: "review.filter_unsupported" },
  { status: 409, filter: '{"and":[{"kind":"attribute","field":"company","in":["missing"]}]}', detail: "The filter selects no cases.", code: "review.empty_selection" },
  { status: 422, filter: "", detail: "An empty filter string is invalid.", code: "filter.shape" },
])("retains the selected scope after $code and retries only that filter", async ({ status, filter, detail, code }) => {
  const requests: (string | null)[] = [];
  server.use(http.get(gatesApi, ({ request }) => {
    const value = new URL(request.url).searchParams.get("filter");
    requests.push(value);
    // An unfiltered fallback would appear to pass, making any scope loss visible to this test.
    return value === null ? HttpResponse.json({ gates: [{ ...measured.gates[0]!, status: "passed" }] }) : HttpResponse.json({ detail, code }, { status });
  }));
  const user = userEvent.setup();
  renderApp(`${path}&filter=${encodeURIComponent(filter)}`);
  const unavailable = await screen.findByTestId("gates-unavailable", {}, T);
  expect(unavailable).toHaveTextContent(detail);
  expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  expect(screen.queryByTestId("gate-selection-counts")).not.toBeInTheDocument();
  expect(screen.getByTestId("act-gates")).not.toHaveTextContent("have a reading");
  await user.click(within(unavailable).getByRole("button", { name: "Retry these checks" }));
  await waitFor(() => expect(requests).toHaveLength(2), T);
  expect(requests).toEqual([filter, filter]);
});

it("refuses a legacy successful whole-group response to a filtered query", async () => {
  server.use(http.get(gatesApi, () => HttpResponse.json({ ...measured, filter: undefined, selection: undefined, cases: 120, gates: [{ ...measured.gates[0]!, status: "passed" }] })));
  renderApp(filteredPath);
  expect(await screen.findByTestId("gates-unavailable", {}, T)).toHaveTextContent("No whole-group checks were substituted.");
  expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
});

it.each([409, 422])("withdraws decisions after a %i decision refusal without retrying unfiltered", async (status) => {
  const requests: (string | null)[] = [];
  server.use(
    http.get(gatesApi, ({ request }) => { requests.push(new URL(request.url).searchParams.get("filter")); return HttpResponse.json(measured); }),
    http.post(`${gatesApi}/selected`, ({ request }) => { requests.push(new URL(request.url).searchParams.get("filter")); return HttpResponse.json({ detail: "The selected evidence is unavailable." }, { status }); }),
  );
  const user = userEvent.setup();
  renderApp(filteredPath);
  const row = await screen.findByTestId("gate-selected", {}, T);
  await user.click(within(row).getByRole("button", { name: "Decide" }));
  await user.type(within(row).getByLabelText("Why (required)"), "Reviewed selection");
  await user.type(within(row).getByLabelText("Who decided (required)"), "Reviewer");
  await user.click(within(row).getByRole("button", { name: "Record this reading" }));
  expect(await screen.findByTestId("gates-unavailable", {}, T)).toHaveTextContent("The selected evidence is unavailable.");
  expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  expect(requests).toEqual([filter, filter]);
});

it.each(["", `&filter=${encodeURIComponent(filter)}`])("withholds gates and hypotheses for unsupported drilled context %s", async (suffix) => {
  const requests: string[] = [];
  server.use(http.get(gatesApi, ({ request }) => { requests.push(request.url); return HttpResponse.json(measured); }));
  renderApp(`${path}&within=${encodeURIComponent('{"slicing":"company","key":"[\\"A\\"]"}')}${suffix}`);
  expect(await screen.findByTestId("gates-unavailable", {}, T)).toHaveTextContent("Checks and decisions are unavailable for this drilled selection.");
  await screen.findAllByTestId("driver-card", {}, T);
  expect(requests).toEqual([]);
  expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark to test" })).not.toBeInTheDocument();
});
