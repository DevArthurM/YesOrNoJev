import Papa from "papaparse";
import type { RowData, RowResult } from "@yesornojev/shared";

export type ExportMode = "yes" | "no" | "both";

export interface ExportOptions {
  mode: ExportMode;
  /** Name of the verdict column, required when mode is "both". */
  columnName?: string;
}

export function buildExportCsv(
  columns: string[],
  rows: RowData[],
  results: Record<number, RowResult>,
  options: ExportOptions,
): string {
  if (options.mode === "both") {
    const columnName = options.columnName?.trim();
    if (!columnName) throw new Error("Name the new column first.");
    if (columns.includes(columnName)) throw new Error(`A column named "${columnName}" already exists.`);
    const data = rows.map((row, i) => [...columns.map((c) => row[c] ?? ""), results[i]?.verdict ?? ""]);
    return Papa.unparse({ fields: [...columns, columnName], data });
  }
  const data = rows
    .filter((_, i) => results[i]?.verdict === options.mode)
    .map((row) => columns.map((c) => row[c] ?? ""));
  return Papa.unparse({ fields: columns, data });
}

export function exportFileName(datasetName: string, options: ExportOptions): string {
  const base = datasetName.replace(/\.(csv|tsv|txt)$/i, "");
  const suffix = options.mode === "both" ? "enriched" : `${options.mode}-only`;
  return `${base}.${suffix}.csv`;
}

export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
