import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";
import type { InvestigationQuestions } from "@/lib/api/investigation";
import type { Filter } from "@/lib/api/filter-types";

const endpoint="*/api/v1/projects/p2p2018/runs/run_41/investigation-questions";
const inherited:Filter={and:[{kind:"attribute",field:"region",in:["North"]}]};
const fixture:InvestigationQuestions={
  runId:"run_41",caseNoun:"requests",totalCases:100,selectedCases:20,filter:inherited,family:"repetition",
  choices:{activities:{values:["Review request","Close request"],total:2,truncated:false},attributes:{values:["region"],total:1,truncated:false}},
  questions:[{id:"repeat",family:"repetition",title:"Repeated Review request",status:"observed",summary:"Four requests contain a repeated review.",measurement:"At least two occurrences in the complete recorded path.",parameters:{activity:"Review request",source:null,target:null,relation:null},
    metrics:[{id:"affected_cases",label:"Affected cases",value:4,unit:"cases"},{id:"case_share",label:"Share of selected cases",value:.2,unit:"share"},{id:"extra_events",label:"Extra occurrences",value:5,unit:"events"},{id:"open_cases",label:"Open cases",value:null,unit:"cases"}],
    filter:{and:[...inherited.and,{kind:"count",activity:"Review request",min:2}]},limitations:["A repeated review may be legitimate."],contextNeeded:["Review purpose and authorised exceptions."],nextCheck:"Read sample paths with the process owner.",exampleCaseIds:["sample-1"],rows:[]}],
};
const route='/p/p2p2018/runs/run_41/investigate?family=repetition&filter='+encodeURIComponent(JSON.stringify(inherited));

it("waits for the run minimum before offering the exact selected question ranking",async()=>{
  const recorded = {...db.runs.find(r => r.id === "run_41")!, minCases:1};
  let releaseRun!: () => void;
  const runReady = new Promise<void>(resolve => { releaseRun = resolve; });
  server.use(
    http.get(endpoint,()=>HttpResponse.json(fixture)),
    http.get("*/api/v1/projects/p2p2018/runs", async () => { await runReady; return HttpResponse.json([recorded]); }),
    http.get("*/api/v1/projects/p2p2018/runs/run_41", () => HttpResponse.json(recorded)),
  );
  try {
    renderApp(route);
    const article=await screen.findByRole("article",{name:"Repeated Review request"}, {timeout: 8000});
    expect(within(article).getAllByText("20%")[0]).toBeVisible();
    expect(within(article).getAllByText("4 requests")[0]).toBeVisible();
    const map=within(article).getByRole("link",{name:"Open their process map"});
    expect(new URL(map.getAttribute("href")!,"http://local").searchParams.get("filter")).toBe(JSON.stringify(fixture.questions[0]!.filter));
    // Question evidence can arrive first; no link may silently use the route's minimum of 20.
    expect(within(article).queryByRole("link",{name:"Find the groups to investigate"})).not.toBeInTheDocument();
    expect(within(article).getByRole("button",{name:"Find the groups to investigate"})).toBeDisabled();
    releaseRun();
    const rank=await within(article).findByRole("link",{name:"Find the groups to investigate"}, {timeout:8000});
    await waitFor(() => {
      const url = new URL(rank.getAttribute("href")!, "http://local");
      expect(url.searchParams.get("minCases")).toBe("1");
      expect(url.searchParams.get("filter")).toBe(JSON.stringify(fixture.questions[0]!.filter));
      expect(url.searchParams.get("slicing")).toBe(recorded.slicings?.[0]?.id);
    });
    expect(within(article).getByText("Measurement details and data coverage").closest("details")).not.toHaveAttribute("open");
    await userEvent.setup().click(within(article).getByText("Measurement details and data coverage"));
    expect(within(article).getByText("Unavailable")).toBeVisible();
  } finally { releaseRun(); }
});

it("does not offer broadening drill links for a relationship with no exact filter",async()=>{
  server.use(http.get(endpoint,()=>HttpResponse.json({...fixture,questions:[{...fixture.questions[0],filter:null}]})));
  renderApp(route);
  const article=await screen.findByRole("article",{name:"Repeated Review request"}, {timeout: 8000});
  expect(within(article).queryByRole("link",{name:"Open their process map"})).not.toBeInTheDocument();
  expect(within(article).queryByRole("button",{name:"Common process paths"})).not.toBeInTheDocument();
  expect(within(article).getByRole("status")).toHaveTextContent("cannot yet be carried as an exact selection");
});

it("submits dataset-specific questions without stale incompatible parameters",async()=>{
  const requests:URL[]=[];
  server.use(http.get(endpoint,({request})=>{requests.push(new URL(request.url));return HttpResponse.json(fixture);}));
  renderApp(route);await screen.findByRole("article",{name:"Repeated Review request"}, {timeout: 8000});
  const user=userEvent.setup();
  await user.selectOptions(screen.getByLabelText("What would you like to understand?"),"timing");
  await user.selectOptions(screen.getByLabelText("From activity"),"Review request");
  await user.selectOptions(screen.getByLabelText("To activity"),"Close request");
  await user.click(screen.getByRole("button",{name:"Explore this question"}));
  await screen.findByRole("article",{name:"Repeated Review request"}, {timeout: 8000});
  expect(requests.at(-1)!.searchParams.get("family")).toBe("timing");
  expect(requests.at(-1)!.searchParams.get("source")).toBe("Review request");
  expect(requests.at(-1)!.searchParams.get("filter")).toBe(JSON.stringify(inherited));
  expect(requests.at(-1)!.searchParams.has("activity")).toBe(false);
});


it("changes the compact profile selector without losing the inherited selection", async () => {
  server.use(http.get(endpoint, () => HttpResponse.json({...fixture, questions:[...fixture.questions,{...fixture.questions[0],id:"other",title:"Another recorded pattern"}]})));
  renderApp(route);
  const select = await screen.findByRole("combobox", {name:"Choose a recorded pattern (2)"}, {timeout:8000});
  await userEvent.setup().selectOptions(select, "other");
  const article = await screen.findByRole("article", {name:"Another recorded pattern"});
  expect(screen.getByText("Showing evidence: Another recorded pattern")).toHaveAttribute("role", "status");
  const link = within(article).getByRole("link", {name:"Open their process map"});
  expect(new URL(link.getAttribute("href")!, "http://local").searchParams.get("filter")).toBe(JSON.stringify(fixture.questions[0]!.filter));
});
