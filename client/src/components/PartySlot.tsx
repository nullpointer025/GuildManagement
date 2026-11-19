import { useDroppable } from "@dnd-kit/core";
import type { Player } from "../types";
import { DraggablePlayer } from "./DraggablePlayer";
import { PlayerCard } from "./PlayerCard";

interface PartySlotProps {
  partyIndex: number;
  slotIndex: number;
  player: Player | null;
  onRemove: () => void;
  onOpenPicker: () => void;
  readOnly?: boolean;
}

export function PartySlot({ partyIndex, slotIndex, player, onRemove, onOpenPicker, readOnly = false }: PartySlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${partyIndex}-${slotIndex}`,
    data: { type: "slot", partyIndex, slotIndex },
    disabled: readOnly,
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "min-h-[74px] rounded-xl border-2 border-dashed p-1 transition-colors",
        isOver ? "border-gold bg-gold/10" : "border-border-soft",
      ].join(" ")}
    >
      {player && readOnly ? (
        <PlayerCard player={player} />
      ) : !player && readOnly ? (
        <div className="flex h-[66px] w-full items-center justify-center rounded-lg text-sm text-ink-dim/60">
          Slot {slotIndex + 1}
        </div>
      ) : player ? (
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
