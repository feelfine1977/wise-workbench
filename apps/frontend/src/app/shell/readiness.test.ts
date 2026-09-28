import { describe, expect, it } from "vitest";
import { summarizeReadiness } from "./readiness";

describe("readiness summaries", () => {
  it("separates failures and warnings without counting informational checks", () => {
    expect(summarizeReadiness({status:"fail",items:[{id:"f",level:"fail",message:"coverage"},{id:"w",level:"warn",message:"precision"},{id:"p",level:"info",message:"valid"}]}))
      .toMatchObject({failures:1,warnings:1,total:2,label:"1 blocking issue · 1 warning",hasIssues:true});
  });
  it("does not turn missing check details into zero problems", () => {
    expect(summarizeReadiness(undefined).label).toBe("Checks unavailable");
    expect(summarizeReadiness({status:"warn"})).toMatchObject({label:"Warnings reported · details unavailable",hasIssues:true});
    expect(summarizeReadiness({status:"fail",items:[]})).toMatchObject({label:"Blocking checks reported · details unavailable",hasIssues:true});
    expect(summarizeReadiness({status:"pass"})).toMatchObject({label:"Checks passed",hasIssues:false});
  });
  it("retains reported failure severity even when only warnings have details", () => {
    expect(summarizeReadiness({status:"fail",items:[{id:"w",level:"warn",message:"precision"}]}).label)
      .toBe("Blocking checks reported · details unavailable (0 blocking issues · 1 warning listed)");
  });
});
