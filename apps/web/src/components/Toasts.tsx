import { useToasts } from "../store/toasts";

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast--${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.tone === "error" ? "! " : "› "}
          {t.message}
        </button>
      ))}
    </div>
  );
}
