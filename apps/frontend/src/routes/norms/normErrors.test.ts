import { expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { normConstraintNames, normRefusal } from "./normErrors";

it("names the affected expectation without exposing protocol codes or mistaking c1 for c10", () => {
  const error = new ApiError(422, { title: "Norm decision refused", status: 422, detail: "missing rationale: c1", code: "norm.rationale_required" });
  const text = normRefusal(error, { c1: "Shipping target", c10: "Receipt timing" }, "save");
  expect(text).toBe("Add a reason and an owner for “Shipping target”.");
  expect(text).not.toMatch(/422|c1|Receipt timing/);
});

it("unknown raw details and ids stay out of the visible refusal while the user gets a next step", () => {
  const error = new ApiError(422, { title: "Norm decision refused", status: 422, detail: "422: unknown clause c_internal_secret at params[3]", code: "norm.invalid" });
  expect(normRefusal(error, {}, "save")).toBe("Check the edited rule and its scope, then try again.");
  expect(normRefusal(new ApiError(422, { title: "Norm decision refused", status: 422, detail: "unlabelled_id", code: "norm.rationale_required" }), { unlabelled_id: "unlabelled_id" }, "sign")).toBe("Add a reason and an owner for each changed expectation.");
});

it("uses available plain names and gives actionable signer and scope advice", () => {
  const names = normConstraintNames({ constraints: [{ id: "a", plain_name: "Shipping" }, { id: "b", description: "Receipt expected" }, { id: "c" }, null] });
  expect(names).toEqual({ a: "Shipping", b: "Receipt expected", c: "this expectation" });
  expect(normRefusal(new ApiError(422, { title: "Norm decision refused", status: 422, code: "norm.author" }), names, "sign")).toBe("Enter the name of the person signing this version.");
  expect(normRefusal(new ApiError(422, { title: "Norm decision refused", status: 422, code: "norm.not_applicable_note" }), names, "save")).toContain("outside scope or cannot be judged from this log");
});
