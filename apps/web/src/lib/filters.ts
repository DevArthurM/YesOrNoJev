import type { RowData, RowResult, Verdict } from "@yesornojev/shared";

export type VerdictFilter = Verdict | "pending";

export interface ColumnFilter {
  contains?: string;
  min?: number;
  max?: number;
}

export interface Filters {
  columns: Record<string, ColumnFilter>;
  verdicts: VerdictFilter[];
}

export const emptyFilters = (): Filters => ({ columns: {}, verdicts: [] });

export function activeFilterCount(filters: Filters): number {
  const columnCount = Object.values(filters.columns).filter(
    (f) => Boolean(f.contains?.trim()) || f.min !== undefined || f.max !== undefined,
  ).length;
  return columnCount + (filters.verdicts.length > 0 ? 1 : 0);
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function rowMatches(row: RowData, result: RowResult | undefined, filters: Filters): boolean {
  if (filters.verdicts.length > 0) {
    const verdict: VerdictFilter = result?.verdict ?? "pending";
    if (!filters.verdicts.includes(verdict)) return false;
  }
  for (const [column, filter] of Object.entries(filters.columns)) {
    const value = row[column] ?? "";
    const needle = filter.contains?.trim().toLowerCase();
    if (needle && !value.toLowerCase().includes(needle)) return false;
    if (filter.min !== undefined || filter.max !== undefined) {
      const n = toNumber(value);
      if (n === undefined) return false;
      if (filter.min !== undefined && n < filter.min) return false;
      if (filter.max !== undefined && n > filter.max) return false;
    }
  }
  return true;
}

/** Returns the dataset indices of rows that pass every filter. */
export function applyFilters(rows: RowData[], results: Record<number, RowResult>, filters: Filters): number[] {
  const indices: number[] = [];
  rows.forEach((row, i) => {
    if (rowMatches(row, results[i], filters)) indices.push(i);
  });
  return indices;
}
