import type { CSSProperties } from "react";

export type JevBotState = "idle" | "thinking" | "yes" | "no" | "error";

/**
 * The impossibl identity sprite: a 7x7 character map with a gray head and white eyes.
 * Per the design system, the eyes are the only moving part and they cut, never tween.
 */
export const SPRITE = [".bbbbb.", ".bbbbb.", ".bebeb.", ".bbbbb.", "..bbb..", "bbbbbbb", "bbbbbbb"];

const BODY: [number, number][] = SPRITE.flatMap((line, y) =>
  [...line].flatMap((char, x) => (char === "b" ? [[x, y] as [number, number]] : [])),
);
const EYES: [number, number][] = SPRITE.flatMap((line, y) =>
  [...line].flatMap((char, x) => (char === "e" ? [[x, y] as [number, number]] : [])),
);

interface JevBotProps {
  state?: JevBotState;
  size?: number;
  /** Seed that de-syncs idle animations between rows. */
  seed?: number;
  title?: string;
}

export function JevBot({ state = "idle", size = 21, seed = 0, title }: JevBotProps) {
  // Pseudo-random but stable per seed, so neighbours never blink in unison.
  const r = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  const style = {
    "--bot-delay-gaze": `${-r(1) * 9}s`,
    "--bot-delay-blink": `${-r(2) * 5}s`,
    "--bot-dur-gaze": `${7 + r(3) * 5}s`,
    "--bot-dur-blink": `${3.5 + r(4) * 3}s`,
  } as CSSProperties;

  return (
    <span className={`jevbot jevbot--${state}`} style={style} role="img" aria-label={title ?? `jev ${state}`} title={title}>
      <svg viewBox="0 0 7 7" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
        <g className="jevbot__body">
          {BODY.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
          ))}
        </g>
        <g className="jevbot__eyes">
          <g className="jevbot__eyes-inner">
            {EYES.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
            ))}
          </g>
        </g>
      </svg>
      {state === "thinking" && (
        <span className="jevbot__thought" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}
