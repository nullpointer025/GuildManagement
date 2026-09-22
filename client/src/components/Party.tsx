import { useEffect, useState } from "react";
import type { Player } from "../types";
import { PartySlot } from "./PartySlot";

interface PartyProps {
  partyIndex: number;
  name: string | null;
  members: (Player | null)[];
  onRemove: (slotIndex: number) => void;
  onRename: (name: string) => void;
  onOpenPicker: (slotIndex: number) => void;
}

export function Party({ partyIndex, name, members, onRemove, onRename, onOpenPicker }: PartyProps) {
  const [draft, setDraft] = useState(name ?? "");

  useEffect(() => {
    setDraft(name ?? "");
  }, [name]);

  const filled = members.filter(Boolean).length;
  const totalGs = members.reduce((sum, m) => sum + (m?.gear_score ?? 0), 0);
  const avgGs = filled > 0 ? Math.round(totalGs / filled) : 0;
  const full = filled === members.length;

  function commit() {
    const trimmed = draft.trim();
    if (trimmed !== (name ?? "")) onRename(trimmed);
    setDraft(trimmed);
  }

  return (
    <div
      className={[
        "rounded-2xl border bg-panel p-4 transition-colors",
        full ? "border-gold/40" : "border-border",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-base font-semibold text-heading">{partyIndex + 1}</span>
          <span className="shrink-0 text-base text-ink-dim">—</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="Name this party…"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-base font-semibold text-heading outline-none placeholder:font-normal placeholder:text-ink-dim/50 hover:border-border focus:border-gold focus:bg-panel-alt"
          />
        </div>
        <span className="shrink-0 text-sm text-ink-dim">
          {filled}/{members.length}
          {avgGs > 0 && <span className="text-gold"> · avg {avgGs.toLocaleString()}</span>}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {members.map((m, slotIndex) => (
          <PartySlot
            key={slotIndex}
            partyIndex={partyIndex}
            slotIndex={slotIndex}
            player={m}
            onRemove={() => onRemove(slotIndex)}
            onOpenPicker={() => onOpenPicker(slotIndex)}
          />
        ))}
      </div>
    </div>
  );
}
