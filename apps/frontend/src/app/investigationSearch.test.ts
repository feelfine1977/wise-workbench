import { describe, expect, it } from "vitest";
import { validateInvestigationSearch } from "./investigationSearch";

describe("process question links", () => {
  it.each(["never", "", 5, null])("refuses an unsupported relationship %s instead of choosing direct", relation => {
    expect(() => validateInvestigationSearch({family:"timing",source:"A",target:"B",relation})).toThrow("Unknown activity relationship");
  });
  it.each(["nope", "", 5, null])("refuses an unsupported family %s instead of choosing overview", family => {
    expect(() => validateInvestigationSearch({family})).toThrow("Unknown process question");
  });
  it("preserves an explicit valid question and an invalid filter for server rejection", () => {
    const question = {family:"timing",source:"A",target:"B",relation:"eventual",filter:"{",view:"Finance"};
    expect(validateInvestigationSearch(question)).toMatchObject(question);
    expect(validateInvestigationSearch({}).family).toBeUndefined();
  });
});
