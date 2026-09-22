import type { Player } from "../types";
import { getClassColor } from "../lib/classColors";

interface PlayerCardProps {
  player: Player;
  dragging?: boolean;
  overlay?: boolean;
  clickable?: boolean;
  onRemove?: () => void;
}

function formatNumber(n: number | null) {
  return n == null ? "—" : n.toLocaleString();
}

export function PlayerCard({ player, dragging, overlay, clickable, onRemove }: PlayerCardProps) {
  const classColor = getClassColor(player.class);

  return (
    <div
      style={{ borderLeftColor: classColor }}
      className={[
        "group relative rounded-xl border border-l-4 px-4 py-3 select-none transition-colors",
        overlay
          ? "border-gold bg-panel-soft shadow-2xl shadow-black/50 cursor-grabbing"
          : clickable
            ? "border-border-soft bg-panel-alt hover:border-gold hover:bg-panel-soft cursor-pointer"
            : "border-border-soft bg-panel-alt hover:border-gold/50 cursor-grab",
        dragging ? "opacity-30" : "opacity-100",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-base font-semibold text-heading">{player.ign}</span>
        {player.level != null && (
          <span className="shrink-0 text-sm text-ink-dim">Lv.{player.level}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-ink-dim">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: classColor }}
            aria-hidden
          />
          <span className="truncate">{player.class ?? "—"}</span>
        </span>
        <span className="shrink-0 font-mono text-sm font-semibold text-gold">
          {formatNumber(player.gear_score)}
        </span>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-panel text-sm text-ink-dim hover:border-danger hover:text-danger group-hover:flex"
          aria-label={`Remove ${player.ign}`}
          title="Remove from party"
        >
          ×
        </button>
      )}
    </div>
  );
}
