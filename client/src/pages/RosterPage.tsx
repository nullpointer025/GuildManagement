import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { DiscordSyncSummary, ImportSummary, Player, PlayerFlag } from "../types";
import { CsvDropzone } from "../components/CsvDropzone";

type SortKey = "gear_score" | "level" | "ign" | "total_contribution";

const BOM = "\uFEFF";
const CRLF = "\r\n";

export function RosterPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gear_score");
  const [showInactive, setShowInactive] = useState(false);
  const [onlyNotInDiscord, setOnlyNotInDiscord] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<DiscordSyncSummary | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Failed to import CSV");
      return;
    } finally {
      setImporting(false);
    }
    // New players start unticked, so re-check Discord right after every import.
    await handleDiscordSync();
  }

  async function handleDiscordSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const { summary } = await api.syncDiscord();
      setSyncSummary(summary);
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : "Failed to sync with Discord");
    } finally {
      setSyncing(false);
    }
    // Reload even if the sync failed, so a just-imported roster still shows up.
    await loadPlayers();
  }

  async function toggleFlag(player: Player, flag: PlayerFlag) {
    const next = player[flag] !== 1;
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, [flag]: next ? 1 : 0 } : p)));
    try {
      await api.setPlayerFlag(player.id, flag, next);
    } catch {
      setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, [flag]: player[flag] } : p)));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => (showInactive ? true : p.active === 1))
      .filter((p) => (onlyNotInDiscord ? p.in_discord !== 1 : true))
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
  }, [players, search, sortKey, showInactive, onlyNotInDiscord]);

  const activeCount = players.filter((p) => p.active === 1).length;
  const byIgn = (a: Player, b: Player) => a.ign.localeCompare(b.ign);
  const notInDiscord = players.filter((p) => p.active === 1 && p.in_discord !== 1).sort(byIgn);
  const notInDiscordCount = notInDiscord.length;
  const exportLists: { key: string; label: string; players: Player[] }[] = [
    { key: "not-in-discord", label: "Not in Discord", players: notInDiscord },
    { key: "ultimate", label: "Ultimate", players: players.filter((p) => p.active === 1 && p.ultimate === 1).sort(byIgn) },
  ];

  async function copyIgns(key: string, list: Player[]) {
    try {
      await navigator.clipboard.writeText(list.map((p) => p.ign).join("\n"));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      setSyncError("Couldn't copy to the clipboard — use the CSV download instead");
    }
  }

  function downloadCsv(key: string, list: Player[]) {
    const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["IGN", "Class", "Position"], ...list.map((p) => [p.ign, p.class, p.position])].map((r) =>
      r.map(cell).join(",")
    );
    // Leading BOM so Excel reads the file as UTF-8 and shows Thai/Japanese IGNs correctly.
    const blob = new Blob([BOM + rows.join(CRLF)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${key}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-heading">Guild Roster</h1>
        <p className="mt-1.5 text-base text-ink-dim">
          {activeCount} active member{activeCount === 1 ? "" : "s"}
          {" · "}
          <span className={notInDiscordCount > 0 ? "text-danger" : "text-success"}>
            {notInDiscordCount} not in Discord
          </span>
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
        <label className="flex items-center gap-2.5 text-base text-ink-dim">
          <input
            type="checkbox"
            checked={onlyNotInDiscord}
            onChange={(e) => setOnlyNotInDiscord(e.target.checked)}
            className="h-4 w-4 accent-[#d9a441]"
          />
          Only not in Discord
        </label>
        <button
          type="button"
          onClick={handleDiscordSync}
          disabled={syncing}
          className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink hover:border-gold disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync with Discord"}
        </button>
      </div>

      <div className="-mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        {exportLists.map(({ key, label, players: list }) => (
          <div key={key} className="flex items-center gap-2.5">
            <span className="text-base text-ink-dim">
              {label} ({list.length}):
            </span>
            <button
              type="button"
              onClick={() => copyIgns(key, list)}
              disabled={list.length === 0}
              title="Copy these IGNs, one per line"
              className="rounded-lg border border-border bg-panel-alt px-3 py-1.5 text-sm text-ink hover:border-gold disabled:opacity-50"
            >
              {copiedKey === key ? "Copied!" : "Copy IGNs"}
            </button>
            <button
              type="button"
              onClick={() => downloadCsv(key, list)}
              disabled={list.length === 0}
              title="Download IGN, class and position as a CSV file"
              className="rounded-lg border border-border bg-panel-alt px-3 py-1.5 text-sm text-ink hover:border-gold disabled:opacity-50"
            >
              Download CSV
            </button>
          </div>
        ))}
      </div>

      {syncError && <p className="-mt-4 text-base text-danger">{syncError}</p>}
      {syncSummary && !syncError && (
        <p className="-mt-4 text-base text-ink-dim">
          Discord sync complete — checked {syncSummary.discordMembers} server members:{" "}
          <span className="text-success">{syncSummary.matched} in Discord</span>,{" "}
          <span className="text-danger">{syncSummary.missing} not found</span>.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[1000px] border-collapse text-base">
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
              <th className="px-5 py-4 font-medium">Discord</th>
              <th className="px-5 py-4 font-medium">Ultimate</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-5 py-10 text-center text-ink-dim">
                  Loading roster…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-10 text-center text-ink-dim">
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
                <td className="px-5 py-3.5">
                  <input
                    type="checkbox"
                    checked={p.in_discord === 1}
                    onChange={() => toggleFlag(p, "in_discord")}
                    aria-label={`${p.ign} is in Discord`}
                    className="h-4 w-4 accent-[#d9a441]"
                  />
                </td>
                <td className="px-5 py-3.5">
                  <input
                    type="checkbox"
                    checked={p.ultimate === 1}
                    onChange={() => toggleFlag(p, "ultimate")}
                    aria-label={`${p.ign} has Ultimate`}
                    className="h-4 w-4 accent-[#d9a441]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
