import { JevBot } from "./JevBot";

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty__bots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <JevBot key={i} seed={i * 7 + 1} size={42} />
        ))}
      </div>
      <h2 className="empty__title">the jevs are waiting for data</h2>
      <p className="empty__text">drop a csv anywhere or pick one from your computer. every row becomes a json the jevs read and answer with yes or no.</p>
      <div className="empty__actions">
        <button className="button button--primary" onClick={onAdd}>+ add a csv</button>
      </div>
    </div>
  );
}
