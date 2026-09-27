import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { SliceDesigner } from "./SliceDesigner";
import { uniqueSlicingId } from "@/lib/api/groupingSuggestions";
import type { SlicingSpec } from "@/lib/api/exploration";

function Designer({ initial = [] }: { initial?: SlicingSpec[] }) {
  const [rows, setRows] = useState(initial);
  return <><SliceDesigner attributes={["team", "amount_label", "odd_number"]} attributeTypes={{ team: "categorical", amount_label: "categorical", odd_number: "numeric" }} value={rows} onChange={setRows} /><output data-testid="rows">{JSON.stringify(rows)}</output></>;
}
const rows = () => JSON.parse(screen.getByTestId("rows").textContent!) as SlicingSpec[];

it("adds unlimited custom rows with unique IDs, including after edits and removals", async () => {
  const user = userEvent.setup();
  render(<Designer />);
  for (let i = 0; i < 9; i++) await user.click(screen.getByRole("button", { name: "another grouping" }));
  expect(rows()).toHaveLength(9);
  expect(new Set(rows().map((r) => r.id)).size).toBe(9);
  await user.click(screen.getByRole("button", { name: "Remove grouping 2" }));
  await user.click(screen.getByRole("button", { name: "another grouping" }));
  expect(new Set(rows().map((r) => r.id)).size).toBe(9);
  expect(rows().find((r) => r.attributes[0] === "odd_number")?.bands).toEqual([{ attribute: "odd_number", method: "quantile", q: 4 }]);
  expect(rows().find((r) => r.attributes[0] === "amount_label")?.bands).toEqual([]);
});

it("adds and removes any of 1–3 distinct columns and removes orphaned bands", async () => {
  const user = userEvent.setup();
  render(<Designer initial={[{ id: "team", attributes: ["team"] }]} />);
  await user.click(screen.getByRole("combobox", { name: "grouping 1, attribute 2" }));
  expect(screen.queryByRole("option", { name: "team" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /odd_number/ }));
  await user.click(screen.getByRole("combobox", { name: "grouping 1, attribute 3" }));
  await user.click(screen.getByRole("option", { name: "amount_label" }));
  expect(rows()[0]?.attributes).toEqual(["team", "odd_number", "amount_label"]);
  expect(within(screen.getByTestId("slice-designer")).getAllByRole("combobox")).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "Remove odd_number from grouping 1" }));
  expect(rows()[0]?.attributes).toEqual(["team", "amount_label"]);
  expect(rows()[0]?.bands ?? []).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Remove team from grouping 1" }));
  expect(rows()[0]?.attributes).toEqual(["amount_label"]);
  await user.click(screen.getByRole("button", { name: "Remove grouping 1" }));
  expect(rows()).toEqual([]);
});

it("escapes delimiter collisions and allocates IDs against all existing rows", () => {
  expect(uniqueSlicingId({ attributes: ["a+b"] }, [{ id: "a+b", attributes: ["a", "b"] }])).toBe("a%2Bb");
  expect(uniqueSlicingId({ attributes: ["a"] }, [{ id: "a", attributes: ["a"] }, { id: "a#2", attributes: ["a"] }])).toBe("a#3");
});
