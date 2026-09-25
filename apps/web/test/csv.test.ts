import { describe, expect, it } from "vitest";
import { CsvError, normalizeHeaders, parseCsvText } from "../src/lib/csv";

describe("parseCsvText", () => {
  it("turns each row into a JSON object keyed by column name", () => {
    const parsed = parseCsvText('name,employees,note\nAda,120,"likes, commas"\nBob,8,""\n');
    expect(parsed.columns).toEqual(["name", "employees", "note"]);
    expect(parsed.rows).toEqual([
      { name: "Ada", employees: "120", note: "likes, commas" },
      { name: "Bob", employees: "8", note: "" },
    ]);
    expect(parsed.numericColumns).toEqual(["employees"]);
  });

  it("strips a BOM and fills short rows", () => {
    const parsed = parseCsvText("\uFEFFa,b\n1\n");
    expect(parsed.rows).toEqual([{ a: "1", b: "" }]);
  });

  it("rejects empty files and header-only files", () => {
    expect(() => parseCsvText("")).toThrow(CsvError);
    expect(() => parseCsvText("a,b\n")).toThrow(/no rows/);
  });
});

describe("normalizeHeaders", () => {
  it("names blank headers and de-duplicates repeats", () => {
    expect(normalizeHeaders(["name", "", "name", " name "])).toEqual(["name", "column_2", "name_2", "name_3"]);
  });
});
