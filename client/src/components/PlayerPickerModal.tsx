import { useEffect, useMemo, useState } from "react";
import type { Player } from "../types";
import { PlayerCard } from "./PlayerCard";

interface PlayerPickerModalProps {
  partyIndex: number;
  slotIndex: number;
  players: Player[];
  onSelect: (player: Player) => void;
  onClose: () => void;
}

export function PlayerPickerModal({
  partyIndex,
  slotIndex,
  players,
  onSelect,
  onClose,
}: PlayerPickerModalProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => p.ign.toLowerCase().includes(q) || (p.class ?? "").toLowerCase().includes(q)
    );
  }, [players, search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-heading">
              Fill Party {partyIndex + 1} — Slot {slotIndex + 1}
            </h2>
            <p className="text-xs text-ink-dim">{players.length} available</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or class…"
            className="w-full rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
          />
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto px-3 pb-3">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-dim">No matching players.</p>
          )}
          {filtered.map((p) => (
            <button key={p.id} type="button" onClick={() => onSelect(p)} className="text-left">
              <PlayerCard player={p} clickable />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
