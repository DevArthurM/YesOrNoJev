import { describe, expect, it } from "vitest";
import type { RowResult } from "@yesornojev/shared";
import { activeFilterCount, applyFilters, emptyFilters } from "../src/lib/filters";

const rows = [
  { name: "Ada", employees: "1,200" },
  { name: "Bob", employees: "40" },
  { name: "Cleo", employees: "" },
];
const results: Record<number, RowResult> = { 0: { index: 0, verdict: "yes" }, 1: { index: 1, verdict: "no" } };

describe("applyFilters", () => {
  it("returns every row with no filters", () => {
    expect(applyFilters(rows, results, emptyFilters())).toEqual([0, 1, 2]);
  });

  it("filters by text, numeric range and verdict (pending = not answered)", () => {
    expect(applyFilters(rows, results, { columns: { name: { contains: "b" } }, verdicts: [] })).toEqual([1]);
    expect(applyFilters(rows, results, { columns: { employees: { min: 100 } }, verdicts: [] })).toEqual([0]);
    expect(applyFilters(rows, results, { columns: {}, verdicts: ["no", "pending"] })).toEqual([1, 2]);
  });

  it("counts active filters", () => {
    expect(activeFilterCount({ columns: { name: { contains: " " }, employees: { max: 3 } }, verdicts: ["yes"] })).toBe(2);
  });
});
