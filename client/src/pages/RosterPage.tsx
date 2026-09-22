import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ImportSummary, Player } from "../types";
import { CsvDropzone } from "../components/CsvDropzone";

type SortKey = "gear_score" | "level" | "ign" | "total_contribution";

export function RosterPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gear_score");
  const [showInactive, setShowInactive] = useState(false);

  async function loadPlayers() {
    setLoading(true);
    try {
      const { players } = await api.players();
      setPlayers(players);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlayers();
  }, []);

  async function handleFile(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      const { summary } = await api.importCsv(file);
      setSummary(summary);
      await loadPlayers();
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Failed to import CSV");
    } finally {
      setImporting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => (showInactive ? true : p.active === 1))
      .filter((p) => {
        if (!q) return true;
        return (
          p.ign.toLowerCase().includes(q) ||
          (p.class ?? "").toLowerCase().includes(q) ||
          (p.position ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortKey === "ign") return a.ign.localeCompare(b.ign);
        const av = a[sortKey] ?? -1;
        const bv = b[sortKey] ?? -1;
        return bv - av;
      });
  }, [players, search, sortKey, showInactive]);

  const activeCount = players.filter((p) => p.active === 1).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-heading">Guild Roster</h1>
        <p className="mt-1.5 text-base text-ink-dim">
          {activeCount} active member{activeCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-panel p-6">
        <CsvDropzone onFile={handleFile} busy={importing} />
        {importError && <p className="mt-4 text-base text-danger">{importError}</p>}
        {summary && !importError && (
          <p className="mt-4 text-base text-ink-dim">
            Import complete —{" "}
            <span className="text-success">{summary.added} added</span>,{" "}
            <span className="text-gold">{summary.updated} updated</span>
            {summary.flaggedInactive > 0 && (
              <>
                , <span className="text-danger">{summary.flaggedInactive} not in this export</span>
              </>
            )}
            . {summary.activeTotal} active members total.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by IGN, class, or position…"
          className="min-w-72 flex-1 rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
        >
          <option value="gear_score">Sort: Gear Score</option>
          <option value="level">Sort: Level</option>
          <option value="total_contribution">Sort: Total Contribution</option>
          <option value="ign">Sort: Name</option>
        </select>
        <label className="flex items-center gap-2.5 text-base text-ink-dim">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-[#d9a441]"
          />
          Show members not in latest export
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[900px] border-collapse text-base">
          <thead>
            <tr className="border-b border-border bg-panel-alt text-left text-sm uppercase tracking-wide text-ink-dim">
              <th className="px-5 py-4 font-medium">IGN</th>
              <th className="px-5 py-4 font-medium">Lv.</th>
              <th className="px-5 py-4 font-medium">Class</th>
              <th className="px-5 py-4 font-medium">Position</th>
              <th className="px-5 py-4 font-medium">Gear Score</th>
              <th className="px-5 py-4 font-medium">Weekly</th>
              <th className="px-5 py-4 font-medium">Total Contribution</th>
              <th className="px-5 py-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-ink-dim">
                  Loading roster…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-ink-dim">
                  No members found. Import a CSV export to get started.
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr
                key={p.id}
                className={[
                  "border-b border-border-soft last:border-0",
                  p.active === 1 ? "" : "opacity-50",
                ].join(" ")}
              >
                <td className="px-5 py-3.5 font-medium text-heading">{p.ign}</td>
                <td className="px-5 py-3.5 text-ink-dim">{p.level ?? "—"}</td>
                <td className="px-5 py-3.5 text-ink-dim">{p.class ?? "—"}</td>
                <td className="px-5 py-3.5 text-ink-dim">{p.position ?? "—"}</td>
                <td className="px-5 py-3.5 font-mono text-gold">
                  {p.gear_score != null ? p.gear_score.toLocaleString() : "—"}
                </td>
                <td className="px-5 py-3.5 text-ink-dim">{p.weekly ?? "—"}</td>
                <td className="px-5 py-3.5 text-ink-dim">
                  {p.total_contribution != null ? p.total_contribution.toLocaleString() : "—"}
                </td>
                <td className="px-5 py-3.5">
                  {p.active === 1 ? (
                    <span className="rounded-full bg-success/15 px-2.5 py-1 text-sm text-success">
                      In guild
                    </span>
                  ) : (
                    <span className="rounded-full bg-danger/15 px-2.5 py-1 text-sm text-danger">
                      Not in latest export
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
