import { useDroppable } from "@dnd-kit/core";
import type { Player } from "../types";
import { DraggablePlayer } from "./DraggablePlayer";

interface PartySlotProps {
  partyIndex: number;
  slotIndex: number;
  player: Player | null;
  onRemove: () => void;
  onOpenPicker: () => void;
}

export function PartySlot({ partyIndex, slotIndex, player, onRemove, onOpenPicker }: PartySlotProps) {
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
        <button
          type="button"
          onClick={onOpenPicker}
          className="flex h-[66px] w-full items-center justify-center rounded-lg text-sm text-ink-dim/60 transition-colors hover:bg-panel-alt hover:text-ink-dim"
        >
          Slot {slotIndex + 1}
        </button>
      )}
    </div>
  );
}
