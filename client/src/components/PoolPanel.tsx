import { useDroppable } from "@dnd-kit/core";
import type { Player } from "../types";
import { DraggablePlayer } from "./DraggablePlayer";

interface PoolPanelProps {
  players: Player[];
}

export function PoolPanel({ players }: PoolPanelProps) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool", data: { type: "pool" } });

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex min-h-[200px] flex-col gap-2.5 rounded-2xl border p-4 transition-colors",
        isOver ? "border-gold bg-gold/5" : "border-border",
      ].join(" ")}
    >
      {players.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-dim">
          No unassigned players. Drag a card here to bench them.
        </p>
      )}
      {players.map((p) => (
        <DraggablePlayer key={p.id} player={p} from={{ type: "pool" }} />
      ))}
    </div>
  );
}
