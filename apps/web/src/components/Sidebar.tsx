import { useRef, useState } from "react";
import { importFiles } from "../lib/importers";
import { formatInt } from "../lib/format";
import { isRunActive, useDatasets, type Dataset } from "../store/datasets";
import { VerdictBar } from "./VerdictBar";

function DatasetCard({ dataset, selected }: { dataset: Dataset; selected: boolean }) {
  const { select, removeDataset, renameDataset } = useDatasets();
  const [editing, setEditing] = useState(false);
  const running = isRunActive(dataset.run);

  return (
    <li className={`dataset${selected ? " dataset--selected" : ""}`}>
      <button className="dataset__main" onClick={() => select(dataset.id)} onDoubleClick={() => setEditing(true)} title={dataset.name}>
        <span className="dataset__icon" aria-hidden="true">{running ? <span className="spinner-dots">···</span> : "csv"}</span>
        <span className="dataset__info">
          {editing ? (
            <input
              className="dataset__rename"
              defaultValue={dataset.name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                void renameDataset(dataset.id, e.target.value);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <span className="dataset__name">{dataset.name}</span>
          )}
          <span className="dataset__meta">
            <span className="figure">{formatInt(dataset.rowCount)}</span> rows ·{" "}
            <span className="figure">{dataset.columns.length}</span> cols
          </span>
          {dataset.run && <VerdictBar progress={dataset.run.progress} compact />}
        </span>
      </button>
      <div className="dataset__actions">
        <button className="icon-button icon-button--small" onClick={() => setEditing(true)} aria-label={`rename ${dataset.name}`} title="rename">
          ✎
        </button>
        <button className="icon-button icon-button--small" onClick={() => void removeDataset(dataset.id)} aria-label={`remove ${dataset.name}`} title="remove">
          ✕
        </button>
      </div>
    </li>
  );
}

export function Sidebar() {
  const { datasets, selectedId } = useDatasets();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="label">csv files</span>
        <span className="label figure">{datasets.length}</span>
      </div>
      <ul className="dataset-list">
        {datasets.map((d) => (
          <DatasetCard key={d.id} dataset={d} selected={d.id === selectedId} />
        ))}
      </ul>
      <div className="sidebar__footer">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,.tsv,.txt"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button className="button button--wide" onClick={() => fileInput.current?.click()}>
          + add new csv
        </button>
      </div>
    </aside>
  );
}
