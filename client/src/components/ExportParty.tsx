import type { Player } from "../types";
import { PlayerCard } from "./PlayerCard";

interface ExportPartyProps {
  partyIndex: number;
  name: string | null;
  members: (Player | null)[];
}

// Static (non-interactive) mirror of Party/PartySlot, used only for the image export snapshot —
// avoids relying on html-to-image to faithfully paint live <input> values or dnd-kit hooks.
export function ExportParty({ partyIndex, name, members }: ExportPartyProps) {
  const filled = members.filter(Boolean).length;
  const totalGs = members.reduce((sum, m) => sum + (m?.gear_score ?? 0), 0);
  const avgGs = filled > 0 ? Math.round(totalGs / filled) : 0;
  const full = filled === members.length;

  return (
    <div
      className={[
        "rounded-2xl border bg-panel p-4",
        full ? "border-gold/40" : "border-border",
      ].join(" ")}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-base font-semibold text-heading">{partyIndex + 1}</span>
          {name && (
            <>
              <span className="shrink-0 text-base text-ink-dim">—</span>
              <span className="truncate text-base font-semibold text-heading">{name}</span>
            </>
          )}
        </div>
        <span className="shrink-0 text-sm text-ink-dim">
          {filled}/{members.length}
          {avgGs > 0 && <span className="text-gold"> · avg {avgGs.toLocaleString()}</span>}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {members.map((m, slotIndex) =>
          m ? (
            <PlayerCard key={slotIndex} player={m} />
          ) : (
            <div
              key={slotIndex}
              className="min-h-[74px] rounded-xl border-2 border-dashed border-border-soft p-1"
            >
              <div className="flex h-[66px] items-center justify-center text-sm text-ink-dim/60">
                Slot {slotIndex + 1}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
