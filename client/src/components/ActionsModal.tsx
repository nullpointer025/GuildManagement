import { useEffect } from "react";

export interface RaidAction {
  key: string;
  label: string;
  description: string;
}

interface ActionsModalProps {
  boardLabel: string;
  actions: RaidAction[];
  running: string | null;
  notice: string | null;
  onRun: (key: string) => void;
  onClose: () => void;
}

// The raid builder's bulk actions, run against the board currently open.
export function ActionsModal({ boardLabel, actions, running, notice, onRun, onClose }: ActionsModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold text-heading">
            Actions <span className="font-normal text-ink-dim">— {boardLabel}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => onRun(action.key)}
              disabled={running != null}
              className="flex flex-col items-start gap-0.5 rounded-lg border border-border px-4 py-3 text-left hover:border-gold disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-base font-semibold text-ink">
                {running === action.key ? "Assigning…" : action.label}
              </span>
              <span className="text-sm text-ink-dim">{action.description}</span>
            </button>
          ))}
        </div>
        {notice && <p className="border-t border-border p-4 text-sm text-ink-dim">{notice}</p>}
      </div>
    </div>
  );
}
