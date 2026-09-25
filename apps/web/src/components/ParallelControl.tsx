import { MAX_PARALLEL_JEVS } from "@yesornojev/shared";
import { useSettings } from "../store/settings";

export function ParallelControl({ disabled }: { disabled?: boolean }) {
  const { parallel, setParallel } = useSettings();
  return (
    <div className="stepper" title={`how many jevs work in parallel (max ${MAX_PARALLEL_JEVS})`}>
      <span className="stepper__label">jevs</span>
      <button className="stepper__button" onClick={() => setParallel(parallel - 1)} disabled={disabled || parallel <= 1} aria-label="fewer jevs">
        −
      </button>
      <span className="stepper__value figure" aria-live="polite">{parallel}</span>
      <button
        className="stepper__button"
        onClick={() => setParallel(parallel + 1)}
        disabled={disabled || parallel >= MAX_PARALLEL_JEVS}
        aria-label="more jevs"
      >
        +
      </button>
    </div>
  );
}
