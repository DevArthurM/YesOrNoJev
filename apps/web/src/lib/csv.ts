import Papa from "papaparse";
import type { RowData } from "@yesornojev/shared";

export interface ParsedCsv {
  columns: string[];
  numericColumns: string[];
  rows: RowData[];
}

export class CsvError extends Error {}

/** Makes header names unique and non-empty so every cell maps to a JSON key. */
export function normalizeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((raw, i) => {
    const base = raw.trim() || `column_${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function isNumericColumn(rows: RowData[], column: string): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = row[column]?.trim();
    if (!value) continue;
    if (!/^-?\d+(\.\d+)?$/.test(value.replace(/,/g, ""))) return false;
    seen++;
  }
  return seen > 0;
}

export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  const [header, ...body] = result.data;
  if (!header || header.length === 0) throw new CsvError("This file looks empty.");
  if (body.length === 0) throw new CsvError("This CSV has a header but no rows.");
  const columns = normalizeHeaders(header);
  const rows = body.map((cells) => Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ""])));
  return { columns, rows, numericColumns: columns.filter((c) => isNumericColumn(rows, c)) };
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  if (!/\.(csv|tsv|txt)$/i.test(file.name) && !file.type.includes("csv") && !file.type.startsWith("text/")) {
    throw new CsvError(`${file.name} is not a CSV file.`);
  }
  return parseCsvText(await file.text());
}
