import { useDraggable } from "@dnd-kit/core";
import { PlayerCard } from "./PlayerCard";
import type { Player } from "../types";

export type DragOrigin = { type: "pool" } | { type: "slot"; partyIndex: number; slotIndex: number };

interface DraggablePlayerProps {
  player: Player;
  from: DragOrigin;
  onRemove?: () => void;
}

export function DraggablePlayer({ player, from, onRemove }: DraggablePlayerProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${player.id}`,
    data: { player, from },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <PlayerCard player={player} dragging={isDragging} onRemove={onRemove} />
    </div>
  );
}
