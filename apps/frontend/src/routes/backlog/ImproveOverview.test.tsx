import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { verifiedBacklog } from "@/mocks/fixtures/verified";
import { renderApp, ROUTE_READY } from "@/test/utils";

const path = "/p/p2p2018/runs/run_41/backlog?slicing=case%20Vendor&view=Finance";

it("opens the exact bubble group with its view, filter and parent selection intact", async () => {
  const user = userEvent.setup();
  const filter = '{"and":[{"kind":"open","value":true}]}';
  const parent = '{"slicing":"case Company","key":"[\\"companyID_0000\\"]"}';
  const fixture = verifiedBacklog("case Vendor", "Finance")!;
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/backlog", async () => {
    // Exercise route readiness beyond Testing Library's default one-second wait.
    await delay(1200);
    return HttpResponse.json({ ...fixture, rows: fixture.rows.slice(0, 1), total: 1 });
  }));
  renderApp(`${path}&filter=${encodeURIComponent(filter)}&within=${encodeURIComponent(parent)}`);
  const overview = await screen.findByTestId("priority-support", {}, ROUTE_READY);
  const point = within(overview).getAllByRole("button", { name: /^Investigate / })[0]!;
  point.focus();
  await user.keyboard("{Enter}");
  await screen.findByTestId("contribution-icicle", {}, ROUTE_READY);
  await user.click(screen.getByRole("button", { name: /What can we do/ }));
  const link = await screen.findByRole("link", { name: /Back to why this group is worst/ }, ROUTE_READY);
  const url = new URL(link.getAttribute("href")!, "http://localhost");
  expect(url.searchParams.get("filter")).toBe(filter);
  expect(url.searchParams.get("within")).toBe(parent);
  expect(url.searchParams.get("view")).toBe("Finance");
  expect(url.searchParams.get("slicing")).toBe("case Vendor");
  const group = JSON.parse(decodeURIComponent(url.pathname.split("/").at(-1)!)) as string[];
  expect(point.getAttribute("aria-label")).toContain(group[0]);
});

it("does not substitute a partial page when the all-groups request fails", async () => {
  server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/backlog", ({ request }) => {
    if (new URL(request.url).searchParams.get("pageSize") === "500") return HttpResponse.json({ detail: "The chart population is unavailable." }, { status: 503 });
  }));
  renderApp(`${path}&tab=scatter`);
  expect(await screen.findByRole("alert", {}, ROUTE_READY)).toBeVisible();
  expect(screen.getByText("The chart population is unavailable.")).toBeInTheDocument();
  expect(screen.queryByTestId("priority-support")).not.toBeInTheDocument();
});

it("has a visible problem key and uses the shell view control without a duplicate selector", async () => {
  renderApp(path);
  const chart = await screen.findByTestId("priority-support", {}, ROUTE_READY);
  const key = within(chart).getByRole("list", { name: "Problem kind key" });
  expect(within(key).getAllByRole("listitem")).toHaveLength(4);
  expect(key).toHaveTextContent("Unknown / unclassified");
  expect(chart).toHaveTextContent("Kinds describe assessed patterns, not proven causes");
  expect(screen.queryByRole("combobox", { name: /Switch perspective|Switch view/ })).not.toBeInTheDocument();
});
