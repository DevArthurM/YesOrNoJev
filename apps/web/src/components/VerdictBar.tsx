import type { JobProgress } from "@yesornojev/shared";

/**
 * Proportional yes/no/error bar. Following the impossibl dither language:
 * the emphasized series (yes) is a solid fill, "no" is a dot dither, errors are red hatch.
 */
export function VerdictBar({ progress, compact }: { progress: JobProgress; compact?: boolean }) {
  const total = Math.max(progress.total, 1);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <span className={`verdict-bar${compact ? " verdict-bar--compact" : ""}`} aria-hidden="true">
      <span className="verdict-bar__yes" style={{ width: pct(progress.yes) }} />
      <span className="verdict-bar__no" style={{ width: pct(progress.no) }} />
      <span className="verdict-bar__error" style={{ width: pct(progress.errors) }} />
    </span>
  );
}
