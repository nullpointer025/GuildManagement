import { useEffect, useState } from "react";

interface NotesModalProps {
  initialNotes: string;
  saving: boolean;
  onSave: (notes: string) => void;
  onClose: () => void;
}

export function NotesModal({ initialNotes, saving, onSave, onClose }: NotesModalProps) {
  const [draft, setDraft] = useState(initialNotes);

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
          <h2 className="text-base font-semibold text-heading">Raid Notes</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Strategy notes, reminders, loot rules…"
            rows={8}
            className="w-full resize-none rounded-lg border border-border bg-panel-alt px-4 py-3 text-base text-ink outline-none focus:border-gold"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-ink hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving}
            className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
