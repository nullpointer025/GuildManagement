import type { Player } from "../types";
import { getClassColor } from "../lib/classColors";

interface Props {
  parties: (Player | null)[][];
}

// How many of each class are deployed on one board, most common first.
export function ClassCounter({ parties }: Props) {
  const counts = new Map<string, number>();
  for (const player of parties.flat()) {
    if (!player) continue;
    const className = player.class ?? "Unknown";
    counts.set(className, (counts.get(className) ?? 0) + 1);
  }
  const rows = Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (rows.length === 0) {
    return <p className="text-sm text-ink-dim">No players deployed on this board yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rows.map(([className, count]) => (
        <span
          key={className}
          className="flex items-center gap-2 rounded-lg border border-border bg-panel-alt px-3 py-1 text-sm text-ink"
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getClassColor(className) }} />
          {className}
          <span className="font-semibold text-heading">{count}</span>
        </span>
      ))}
    </div>
  );
}
