import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RowData, RowResult } from "@yesornojev/shared";
import { formatPercent } from "../lib/format";
import { isFresh, useDatasets, type Dataset } from "../store/datasets";
import { JevBot, type JevBotState } from "./JevBot";

const ROW_HEIGHT = 38;
const FIXED_COLUMNS = "56px 44px 116px";

function columnWidths(columns: string[], rows: RowData[]): string {
  const sample = rows.slice(0, 200);
  return columns
    .map((column) => {
      const longest = Math.max(column.length, ...sample.map((r) => (r[column] ?? "").length));
      return `${Math.min(320, Math.max(110, longest * 8.4 + 28))}px`;
    })
    .join(" ");
}

function botState(result: RowResult | undefined, thinking: boolean): JevBotState {
  if (thinking) return "thinking";
  return result?.verdict ?? "idle";
}

function VerdictCell({ result, thinking, fresh }: { result?: RowResult; thinking: boolean; fresh: boolean }) {
  if (thinking) return <span className="verdict verdict--thinking">thinking<span className="cursor-underscore">_</span></span>;
  if (!result) return <span className="verdict verdict--empty">·</span>;
  if (result.verdict === "error") {
    return (
      <span className={`verdict verdict--error${fresh ? " verdict--fresh" : ""}`} title={result.error}>
        error
      </span>
    );
  }
  return (
    <span className={`verdict verdict--${result.verdict}${fresh ? " verdict--fresh" : ""}`}>
      <span className="verdict__badge">{result.verdict}</span>
      {result.probability !== undefined && (
        <span className="verdict__p" title="probability the statement is true">
          {formatPercent(result.probability)}
        </span>
      )}
    </span>
  );
}

interface RowProps {
  datasetId: string;
  index: number;
  row: RowData;
  columns: string[];
  result?: RowResult;
  thinking: boolean;
  style: CSSProperties;
}

const Row = memo(function Row({ datasetId, index, row, columns, result, thinking, style }: RowProps) {
  const fresh = Boolean(result) && isFresh(datasetId, index);
  return (
    <div className={`table-row${thinking ? " table-row--thinking" : ""}${fresh ? " table-row--fresh" : ""}`} style={style} role="row">
      <span className="cell cell--index figure" role="cell">{index + 1}</span>
      <span className="cell cell--bot" role="cell">
        <JevBot state={botState(result, thinking)} seed={index} size={18} title={result?.error} />
      </span>
      <span className="cell cell--verdict" role="cell">
        <VerdictCell result={result} thinking={thinking} fresh={fresh} />
      </span>
      {columns.map((column) => (
        <span key={column} className="cell" role="cell" title={row[column]}>
          {row[column]}
        </span>
      ))}
    </div>
  );
});

interface DataTableProps {
  dataset: Dataset;
  rows: RowData[];
  visible: number[];
  follow: boolean;
}

export function DataTable({ dataset, rows, visible, follow }: DataTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const thinking = useDatasets((s) => s.thinking[dataset.id]);
  const { columns } = dataset;
  const template = useMemo(() => `${FIXED_COLUMNS} ${columnWidths(columns, rows)}`, [columns, rows]);
  const results = dataset.run?.results ?? {};

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the rows the jevs are working on in view while a run is live.
  useEffect(() => {
    if (!follow || !thinking || thinking.size === 0) return;
    const newest = Math.max(...thinking);
    const position = visible.indexOf(newest);
    if (position >= 0) virtualizer.scrollToIndex(position, { align: "auto" });
  }, [follow, thinking, visible, virtualizer]);

  const questionLabel = dataset.run?.question ?? "verdict";

  return (
    <div className="table" role="table" aria-label={dataset.name} aria-rowcount={visible.length}>
      <div className="table__scroller" ref={scroller}>
        <div className="table__inner" style={{ "--template": template } as CSSProperties}>
          <div className="table-row table-row--header" role="row">
            <span className="cell cell--index" role="columnheader">#</span>
            <span className="cell cell--bot" role="columnheader">jev</span>
            <span className="cell cell--verdict" role="columnheader" title={questionLabel}>
              verdict
            </span>
            {dataset.columns.map((column) => (
              <span key={column} className="cell" role="columnheader" title={column}>
                {column}
              </span>
            ))}
          </div>
          <div className="table__body" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const index = visible[item.index]!;
              return (
                <Row
                  key={index}
                  datasetId={dataset.id}
                  index={index}
                  row={rows[index]!}
                  columns={dataset.columns}
                  result={results[index]}
                  thinking={thinking?.has(index) ?? false}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                />
              );
            })}
          </div>
        </div>
        {visible.length === 0 && <p className="table__empty">no rows match these filters.</p>}
      </div>
    </div>
  );
}
