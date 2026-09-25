import { formatInt, formatUsd } from "../lib/format";
import { isRunActive, type DatasetRun } from "../store/datasets";
import { VerdictBar } from "./VerdictBar";

interface RunStatusProps {
  run: DatasetRun;
  follow: boolean;
  onToggleFollow: () => void;
  onRetryErrors: () => void;
}

const STATUS_TEXT: Record<DatasetRun["status"], string> = {
  starting: "waking up the jevs",
  running: "jevs at work",
  done: "done",
  cancelled: "stopped",
  failed: "failed",
};

export function RunStatus({ run, follow, onToggleFollow, onRetryErrors }: RunStatusProps) {
  const { progress } = run;
  const active = isRunActive(run);
  return (
    <section className={`run-status${active ? " run-status--active" : ""}`} aria-live="polite">
      <div className="run-status__top">
        <p className="run-status__question" title={run.question}>
          <span className="label">{STATUS_TEXT[run.status]}{active && <span className="cursor-underscore">_</span>}</span>
          <span className="run-status__q">“{run.question}”</span>
        </p>
        <div className="run-status__figures">
          <span className="stat"><span className="figure">{formatInt(progress.done)}</span><span className="stat__of">/{formatInt(progress.total)}</span></span>
          <span className="stat stat--yes"><span className="stat__label">yes</span><span className="figure">{formatInt(progress.yes)}</span></span>
          <span className="stat stat--no"><span className="stat__label">no</span><span className="figure">{formatInt(progress.no)}</span></span>
          {progress.errors > 0 && (
            <span className="stat stat--error"><span className="stat__label">err</span><span className="figure">{formatInt(progress.errors)}</span></span>
          )}
          <span className="stat" title="estimated cost of this run"><span className="figure">{formatUsd(progress.costUsd)}</span></span>
        </div>
      </div>
      <VerdictBar progress={progress} />
      {(run.error || active || progress.errors > 0) && (
        <div className="run-status__bottom">
          {run.error ? <span className="form-error">{run.error}</span> : <span />}
          <div className="run-status__actions">
            {active && (
              <label className="toggle">
                <input type="checkbox" checked={follow} onChange={onToggleFollow} /> follow the jevs
              </label>
            )}
            {!active && progress.errors > 0 && (
              <button className="text-button" onClick={onRetryErrors}>retry {progress.errors} errors ↻</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
