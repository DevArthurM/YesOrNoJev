import { useState } from "react";
import { slugifyQuestion } from "@yesornojev/shared";
import { buildExportCsv, downloadText, exportFileName, type ExportMode } from "../lib/export";
import { formatInt } from "../lib/format";
import type { Dataset } from "../store/datasets";
import { toast } from "../store/toasts";
import { Modal } from "./Modal";

export function ExportModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const run = dataset.run;
  const [mode, setMode] = useState<ExportMode>("both");
  const [columnName, setColumnName] = useState(() => slugifyQuestion(run?.question ?? ""));
  const [error, setError] = useState<string>();
  const results = run?.results ?? {};
  const counts = { yes: run?.progress.yes ?? 0, no: run?.progress.no ?? 0, both: dataset.rowCount };

  const options: { mode: ExportMode; title: string; detail: string }[] = [
    { mode: "yes", title: "only yes", detail: `${formatInt(counts.yes)} rows where the jevs said yes` },
    { mode: "no", title: "only no", detail: `${formatInt(counts.no)} rows where the jevs said no` },
    { mode: "both", title: "both, with a new column", detail: `all ${formatInt(counts.both)} rows + a yes/no column` },
  ];

  const exportCsv = () => {
    try {
      const csv = buildExportCsv(dataset.columns, dataset.rows ?? [], results, { mode, columnName });
      const fileName = exportFileName(dataset.name, { mode });
      downloadText(fileName, csv);
      toast(`exported ${fileName}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      title="export csv"
      onClose={onClose}
      footer={
        <>
          <button className="button button--ghost" onClick={onClose}>cancel</button>
          <button className="button button--primary" onClick={exportCsv} disabled={mode !== "both" && counts[mode] === 0}>
            export ↓
          </button>
        </>
      }
    >
      {run && <p className="modal__lede">“{run.question}”</p>}
      <div className="radio-list" role="radiogroup">
        {options.map((o) => (
          <label key={o.mode} className={`radio${mode === o.mode ? " radio--on" : ""}`}>
            <input type="radio" name="export-mode" checked={mode === o.mode} onChange={() => setMode(o.mode)} />
            <span className="radio__mark" aria-hidden="true">{mode === o.mode ? "■" : "□"}</span>
            <span>
              <span className="radio__title">{o.title}</span>
              <span className="radio__detail">{o.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === "both" && (
        <div className="field">
          <label className="label" htmlFor="column-name">name of the new column</label>
          <input
            id="column-name"
            className="input"
            value={columnName}
            onChange={(e) => {
              setColumnName(e.target.value);
              setError(undefined);
            }}
            spellCheck={false}
          />
          <p className="hint">values: yes · no · error (empty if not answered yet)</p>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
