import { useDroppable } from "@dnd-kit/core";
import type { Player } from "../types";
import { DraggablePlayer } from "./DraggablePlayer";

interface PartySlotProps {
  partyIndex: number;
  slotIndex: number;
  player: Player | null;
  onRemove: () => void;
}

export function PartySlot({ partyIndex, slotIndex, player, onRemove }: PartySlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${partyIndex}-${slotIndex}`,
    data: { type: "slot", partyIndex, slotIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "min-h-[74px] rounded-xl border-2 border-dashed p-1 transition-colors",
        isOver ? "border-gold bg-gold/10" : "border-border-soft",
      ].join(" ")}
    >
      {player ? (
        <DraggablePlayer
          player={player}
          from={{ type: "slot", partyIndex, slotIndex }}
          onRemove={onRemove}
        />
      ) : (
        <div className="flex h-[66px] items-center justify-center text-sm text-ink-dim/60">
          Slot {slotIndex + 1}
        </div>
      )}
    </div>
  );
}
