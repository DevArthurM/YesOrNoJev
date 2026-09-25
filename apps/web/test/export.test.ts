import { describe, expect, it } from "vitest";
import { slugifyQuestion, type RowResult } from "@yesornojev/shared";
import { buildExportCsv, exportFileName } from "../src/lib/export";

const columns = ["name", "note"];
const rows = [
  { name: "Ada", note: 'said "hi", then left' },
  { name: "Bob", note: "" },
  { name: "Cleo", note: "x" },
];
const results: Record<number, RowResult> = {
  0: { index: 0, verdict: "yes" },
  1: { index: 1, verdict: "no" },
  2: { index: 2, verdict: "error", error: "boom" },
};

describe("buildExportCsv", () => {
  it("exports only yes rows, escaping quotes and commas", () => {
    expect(buildExportCsv(columns, rows, results, { mode: "yes" })).toBe('name,note\r\nAda,"said ""hi"", then left"');
  });

  it("exports only no rows", () => {
    expect(buildExportCsv(columns, rows, results, { mode: "no" })).toBe("name,note\r\nBob,");
  });

  it("exports every row with a named verdict column", () => {
    const csv = buildExportCsv(columns, rows, results, { mode: "both", columnName: "is_hot_lead" });
    expect(csv.split("\r\n")).toEqual(["name,note,is_hot_lead", 'Ada,"said ""hi"", then left",yes', "Bob,,no", "Cleo,x,error"]);
  });

  it("requires a new, non-conflicting column name", () => {
    expect(() => buildExportCsv(columns, rows, results, { mode: "both", columnName: " " })).toThrow();
    expect(() => buildExportCsv(columns, rows, results, { mode: "both", columnName: "name" })).toThrow(/already exists/);
  });
});

describe("file names and column slugs", () => {
  it("builds readable names", () => {
    expect(exportFileName("contacts.csv", { mode: "yes" })).toBe("contacts.yes-only.csv");
    expect(exportFileName("contacts.csv", { mode: "both" })).toBe("contacts.enriched.csv");
    expect(slugifyQuestion("Is this a decision maker?")).toBe("is_this_a_decision_maker");
    expect(slugifyQuestion("???")).toBe("jev_verdict");
  });
});
