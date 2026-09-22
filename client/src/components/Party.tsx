import type { Player } from "../types";
import { PartySlot } from "./PartySlot";

interface PartyProps {
  partyIndex: number;
  members: (Player | null)[];
  onRemove: (slotIndex: number) => void;
}

export function Party({ partyIndex, members, onRemove }: PartyProps) {
  const filled = members.filter(Boolean).length;
  const totalGs = members.reduce((sum, m) => sum + (m?.gear_score ?? 0), 0);
  const avgGs = filled > 0 ? Math.round(totalGs / filled) : 0;
  const full = filled === members.length;

  return (
    <div
      className={[
        "rounded-2xl border bg-panel p-4 transition-colors",
        full ? "border-gold/40" : "border-border",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-heading">Party {partyIndex + 1}</h3>
        <span className="text-sm text-ink-dim">
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
          />
        ))}
      </div>
    </div>
  );
}
