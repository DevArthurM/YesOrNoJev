import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { QUESTION_SUGGESTIONS } from "../lib/suggestions";

interface QuestionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
  /** Label for the run button, e.g. "ask 48 rows". */
  runLabel: string;
}

/** Cycles through suggestions with a typewriter effect while the input is empty. */
function useTypewriter(active: boolean) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const full = QUESTION_SUGGESTIONS[index % QUESTION_SUGGESTIONS.length]!;
    let chars = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!deleting) {
        chars++;
        setText(full.slice(0, chars));
        if (chars >= full.length) {
          deleting = true;
          timer = setTimeout(tick, 2000);
          return;
        }
        timer = setTimeout(tick, 38 + Math.random() * 40);
      } else {
        chars--;
        setText(full.slice(0, chars));
        if (chars <= 0) {
          setIndex((i) => i + 1);
          return;
        }
        timer = setTimeout(tick, 16);
      }
    };
    timer = setTimeout(tick, 300);
    return () => clearTimeout(timer);
  }, [active, index]);

  return { text, current: QUESTION_SUGGESTIONS[index % QUESTION_SUGGESTIONS.length]! };
}

export function QuestionInput({ value, onChange, onSubmit, onStop, running, disabled, runLabel }: QuestionInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const empty = value.length === 0;
  const { text, current } = useTypewriter(empty && !running);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && empty) {
      e.preventDefault();
      onChange(current);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (empty) {
      onChange(current);
      return;
    }
    onSubmit();
  };

  return (
    <form className={`question${running ? " question--running" : ""}`} onSubmit={submit}>
      <span className="question__prompt" aria-hidden="true">›</span>
      <div className="question__field">
        <input
          ref={input}
          className="question__input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          aria-label="ask the jevs a yes/no question about every row"
          maxLength={500}
          spellCheck={false}
          autoComplete="off"
          readOnly={running}
        />
        {empty && (
          <span className="question__ghost" aria-hidden="true">
            {text}
            <span className="cursor-underscore">_</span>
            <kbd className="question__hint">tab</kbd>
          </span>
        )}
      </div>
      {running ? (
        <button type="button" className="button button--ghost question__button" onClick={onStop}>
          stop ■
        </button>
      ) : (
        <button type="submit" className="button button--primary question__button" disabled={disabled || empty}>
          {runLabel} ↵
        </button>
      )}
    </form>
  );
}
