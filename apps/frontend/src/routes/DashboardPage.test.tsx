import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";

it("reopens a saved finding in its recorded view and exact filter rather than the dashboard defaults",async()=>{
  const filter={and:[{kind:"count",activity:"Review invoice",min:2}]};
  server.use(http.get("*/api/v1/projects/p2p2018/findings",()=>HttpResponse.json([{
    id:"saved-finding",projectId:"p2p2018",kind:"finding",status:"open",title:"Investigate repeated reviews",runId:"run_41",sliceKey:'["North"]',slicing:"region",view:"Finance",createdAt:"2026-09-27T00:00:00Z",updatedAt:"2026-09-27T00:00:00Z",
    evidenceContext:{runId:"run_41",sliceKey:'["North"]',slicing:"region",view:"Automation",filter,normVersionId:"norm1",normFingerprint:"abc",manifestFingerprint:"def"},
  }])));
  renderApp("/p/p2p2018");
  const records=await screen.findByTestId("open-records", {}, { timeout: 8000 });
  const link=within(records).getByRole("link",{name:"North"});
  const url=new URL(link.getAttribute("href")!,"http://local");
  expect(url.searchParams.get("view")).toBe("Automation");
  expect(url.searchParams.get("slicing")).toBe("region");
  expect(url.searchParams.get("filter")).toBe(JSON.stringify(filter));
  expect(url.searchParams.get("focus")).toBe("finding");
  expect(records).toHaveTextContent("saved selection");
});
