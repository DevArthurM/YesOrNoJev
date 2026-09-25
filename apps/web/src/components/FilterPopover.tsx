import { useEffect, useRef, useState } from "react";
import { activeFilterCount, type ColumnFilter, type Filters, type VerdictFilter } from "../lib/filters";
import type { Dataset } from "../store/datasets";

interface FilterPopoverProps {
  dataset: Dataset;
  filters: Filters;
  onChange: (filters: Filters) => void;
}

const VERDICTS: VerdictFilter[] = ["yes", "no", "error", "pending"];

const parseNumber = (value: string) => (value.trim() === "" || Number.isNaN(Number(value)) ? undefined : Number(value));

export function FilterPopover({ dataset, filters, onChange }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const count = activeFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const setColumn = (column: string, patch: ColumnFilter) =>
    onChange({ ...filters, columns: { ...filters.columns, [column]: { ...filters.columns[column], ...patch } } });

  const toggleVerdict = (verdict: VerdictFilter) =>
    onChange({
      ...filters,
      verdicts: filters.verdicts.includes(verdict) ? filters.verdicts.filter((v) => v !== verdict) : [...filters.verdicts, verdict],
    });

  return (
    <div className="popover-anchor" ref={root}>
      <button
        className={`button${count ? " button--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="filter rows"
      >
        filter{count > 0 && <span className="badge-count">{count}</span>}
      </button>
      {open && (
        <div className="popover filter-popover" role="dialog" aria-label="filters">
          <div className="popover__header">
            <span className="label">filter rows</span>
            <button className="text-button" onClick={() => onChange({ columns: {}, verdicts: [] })} disabled={count === 0}>
              clear all
            </button>
          </div>

          <div className="filter-section">
            <span className="label">jev verdict</span>
            <div className="chips">
              {VERDICTS.map((v) => (
                <button key={v} className={`chip${filters.verdicts.includes(v) ? " chip--on" : ""}`} onClick={() => toggleVerdict(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-columns">
            {dataset.columns.map((column) => {
              const filter = filters.columns[column] ?? {};
              const numeric = dataset.numericColumns.includes(column);
              return (
                <div className="filter-row" key={column}>
                  <span className="filter-row__name" title={column}>{column}</span>
                  {numeric ? (
                    <div className="filter-row__range">
                      <input
                        className="input input--small"
                        inputMode="decimal"
                        placeholder="min"
                        value={filter.min ?? ""}
                        onChange={(e) => setColumn(column, { min: parseNumber(e.target.value) })}
                      />
                      <input
                        className="input input--small"
                        inputMode="decimal"
                        placeholder="max"
                        value={filter.max ?? ""}
                        onChange={(e) => setColumn(column, { max: parseNumber(e.target.value) })}
                      />
                    </div>
                  ) : (
                    <input
                      className="input input--small"
                      placeholder="contains…"
                      value={filter.contains ?? ""}
                      onChange={(e) => setColumn(column, { contains: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
