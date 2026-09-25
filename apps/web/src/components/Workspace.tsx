import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { AppConfig } from "@yesornojev/shared";
import { applyFilters, emptyFilters, type Filters } from "../lib/filters";
import { formatInt } from "../lib/format";
import { importFiles } from "../lib/importers";
import { isRunActive, useDatasets, useSelectedDataset } from "../store/datasets";
import { useSettings } from "../store/settings";
import { AppName, PoweredBy } from "./Brand";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { ExportModal } from "./ExportModal";
import { FilterPopover } from "./FilterPopover";
import { ParallelControl } from "./ParallelControl";
import { QuestionInput } from "./QuestionInput";
import { RunStatus } from "./RunStatus";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

export function Workspace({ config }: { config?: AppConfig }) {
  const dataset = useSelectedDataset();
  const { run, cancel, load, loaded } = useDatasets();
  const { keyMode, signOut } = useSettings();
  const [question, setQuestion] = useState("");
  const [filtersById, setFiltersById] = useState<Record<string, Filters>>({});
  const [exporting, setExporting] = useState(false);
  const [follow, setFollow] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    void load();
  }, [load]);

  // Show the question that produced the current verdicts when switching datasets.
  const datasetId = dataset?.id;
  useEffect(() => {
    setQuestion(useDatasets.getState().datasets.find((d) => d.id === datasetId)?.run?.question ?? "");
  }, [datasetId]);

  const filters = (datasetId && filtersById[datasetId]) || emptyFilters();
  const results = dataset?.run?.results;
  const visible = useMemo(
    () => (dataset?.rows ? applyFilters(dataset.rows, results ?? {}, filters) : []),
    [dataset, results, filters],
  );

  const running = isRunActive(dataset?.run);
  const trimmed = question.trim();
  const sameQuestion = Boolean(dataset?.run && dataset.run.question === trimmed);
  // Re-asking the same question only fills the gaps; a new question starts over.
  const targets = sameQuestion
    ? visible.filter((i) => {
        const verdict = results?.[i]?.verdict;
        return verdict !== "yes" && verdict !== "no";
      })
    : visible;
  const runLabel = !dataset
    ? "ask"
    : sameQuestion && targets.length === 0
      ? "all answered"
      : `${sameQuestion ? "answer" : "ask"} ${formatInt(targets.length)} row${targets.length === 1 ? "" : "s"}`;

  const start = () => {
    if (!dataset || !trimmed || targets.length === 0) return;
    setFollow(true);
    void run(dataset.id, trimmed, targets);
  };

  const retryErrors = () => {
    if (!dataset?.run) return;
    const errored = Object.values(dataset.run.results)
      .filter((r) => r.verdict === "error")
      .map((r) => r.index);
    void run(dataset.id, dataset.run.question, errored);
  };

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
  };

  const openFilePicker = () => document.querySelector<HTMLInputElement>(".sidebar input[type=file]")?.click();

  return (
    <div
      className="workspace"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="topbar__brand">
          <AppName />
        </div>
        <QuestionInput
          value={question}
          onChange={setQuestion}
          onSubmit={start}
          onStop={() => dataset && void cancel(dataset.id)}
          running={running}
          disabled={!dataset || targets.length === 0}
          runLabel={runLabel}
        />
        <div className="topbar__tools">
          {dataset && (
            <FilterPopover
              dataset={dataset}
              filters={filters}
              onChange={(next) => setFiltersById((all) => ({ ...all, [dataset.id]: next }))}
            />
          )}
          <button className="button" onClick={() => setExporting(true)} disabled={!dataset?.run || !dataset.rows || running} title="export csv">
            export
          </button>
          <ParallelControl disabled={running} />
          <ThemeToggle />
        </div>
      </header>

      <Sidebar />

      <main className="main">
        {dataset ? (
          <>
            {dataset.run && (
              <RunStatus run={dataset.run} follow={follow} onToggleFollow={() => setFollow((f) => !f)} onRetryErrors={retryErrors} />
            )}
            {dataset.rows ? (
              <DataTable dataset={dataset} rows={dataset.rows} visible={visible} follow={follow && running} />
            ) : (
              <p className="loading">loading rows<span className="cursor-underscore">_</span></p>
            )}
            <p className="main__meta">
              showing <span className="figure">{formatInt(visible.length)}</span> of{" "}
              <span className="figure">{formatInt(dataset.rowCount)}</span> rows
              {!dataset.run && <> · type a question above and press enter</>}
            </p>
          </>
        ) : (
          loaded && <EmptyState onAdd={openFilePicker} />
        )}
      </main>

      <footer className="footer">
        <span className="footer__key">
          {keyMode === "server" ? "using the server key" : "using your api key"} ·{" "}
          <button className="text-button" onClick={signOut}>change key</button>
        </span>
        <PoweredBy />
        <span className="footer__model">{config?.model ?? "typesafe-ai/jev"}</span>
      </footer>

      {exporting && dataset && <ExportModal dataset={dataset} onClose={() => setExporting(false)} />}
      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <span>drop csv files to add them</span>
        </div>
      )}
    </div>
  );
}
