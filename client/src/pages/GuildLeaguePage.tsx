import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { League, LeagueDetail, Player, TrackerPlayer } from "../types";
import { AddLeagueModal } from "../components/AddLeagueModal";
import { formatCount, formatDate, formatStat } from "../lib/format";

type Tab = "tracker" | "leagues";
type TrackerSort = "attendance" | "kills" | "assists" | "playerDamage" | "buildingDamage" | "ign";

const th = "px-4 py-3 font-medium";
const td = "px-4 py-3";

function attendanceColor(pct: number) {
  if (pct >= 75) return "text-success";
  if (pct >= 50) return "text-gold";
  return "text-danger";
}

function ResultBadge({ result }: { result: League["result"] }) {
  if (!result) return <span className="text-ink-dim">—</span>;
  return result === "victory" ? (
    <span className="rounded-full bg-success/15 px-2.5 py-1 text-sm text-success">Victory</span>
  ) : (
    <span className="rounded-full bg-danger/15 px-2.5 py-1 text-sm text-danger">Defeat</span>
  );
}

export function GuildLeaguePage() {
  const [tab, setTab] = useState<Tab>("tracker");
  const [leagueCount, setLeagueCount] = useState(0);
  const [tracker, setTracker] = useState<TrackerPlayer[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<TrackerSort>("attendance");
  const [onlyMissedLatest, setOnlyMissedLatest] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<number | null>(null);
  const [expandedLeague, setExpandedLeague] = useState<LeagueDetail | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, l, p] = await Promise.all([api.leagueTracker(), api.leagues(), api.players()]);
      setLeagueCount(t.leagueCount);
      setTracker(t.players);
      setLeagues(l.leagues);
      setPlayers(p.players);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const trackerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const value = (p: TrackerPlayer) =>
      sortKey === "attendance" ? p.attended : sortKey === "ign" ? 0 : (p.averages[sortKey] ?? -1);
    return tracker
      .filter((p) => showLeft || p.active === 1)
      .filter((p) => !onlyMissedLatest || p.missedLatest)
      .filter((p) => !q || p.ign.toLowerCase().includes(q) || (p.class ?? "").toLowerCase().includes(q))
      .sort((a, b) => (sortKey === "ign" ? a.ign.localeCompare(b.ign) : value(b) - value(a) || a.ign.localeCompare(b.ign)));
  }, [tracker, search, sortKey, onlyMissedLatest, showLeft]);

  async function toggleLeague(id: number) {
    if (expandedLeague?.id === id) {
      setExpandedLeague(null);
      return;
    }
    const { league } = await api.league(id);
    setExpandedLeague(league);
  }

  async function deleteLeague(id: number) {
    await api.deleteLeague(id);
    setConfirmDeleteId(null);
    if (expandedLeague?.id === id) setExpandedLeague(null);
    await load();
  }

  const missedLatestCount = tracker.filter((p) => p.active === 1 && p.missedLatest).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-heading">Guild League</h1>
          <p className="mt-1.5 text-base text-ink-dim">
            {leagueCount} league{leagueCount === 1 ? "" : "s"} recorded
            {leagueCount > 0 && (
              <>
                {" · "}
                <span className={missedLatestCount > 0 ? "text-danger" : "text-success"}>
                  {missedLatestCount} active member{missedLatestCount === 1 ? "" : "s"} missed the latest
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg bg-gold px-4 py-2.5 text-base font-semibold text-bg transition-colors hover:bg-gold-bright"
        >
          + Add guild league
        </button>
      </div>

      <div className="flex items-center gap-1 self-start rounded-lg border border-border p-1">
        {(["tracker", "leagues"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
              tab === t ? "bg-gold text-bg" : "text-ink-dim hover:bg-panel-alt hover:text-ink",
            ].join(" ")}
          >
            {t === "tracker" ? "PLAYER TRACKER" : "LEAGUES"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-base text-ink-dim">Loading…</p>
      ) : tab === "tracker" ? (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by IGN or class…"
              className="min-w-72 flex-1 rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as TrackerSort)}
              className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
            >
              <option value="attendance">Sort: Attendance</option>
              <option value="kills">Sort: Avg Kills</option>
              <option value="assists">Sort: Avg Assists</option>
              <option value="playerDamage">Sort: Avg Player Damage</option>
              <option value="buildingDamage">Sort: Avg Building Damage</option>
              <option value="ign">Sort: Name</option>
            </select>
            <label className="flex items-center gap-2.5 text-base text-ink-dim">
              <input
                type="checkbox"
                checked={onlyMissedLatest}
                onChange={(e) => setOnlyMissedLatest(e.target.checked)}
                className="h-4 w-4 accent-[#d9a441]"
              />
              Only missed latest league
            </label>
            <label className="flex items-center gap-2.5 text-base text-ink-dim">
              <input
                type="checkbox"
                checked={showLeft}
                onChange={(e) => setShowLeft(e.target.checked)}
                className="h-4 w-4 accent-[#d9a441]"
              />
              Show members who left
            </label>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[1000px] border-collapse text-base">
              <thead>
                <tr className="border-b border-border bg-panel-alt text-left text-sm uppercase tracking-wide text-ink-dim">
                  <th className={th}>Player</th>
                  <th className={th}>Attendance</th>
                  <th className={`${th} text-right`}>Avg Kills</th>
                  <th className={`${th} text-right`}>Avg Assists</th>
                  <th className={`${th} text-right`}>Avg Player Dmg</th>
                  <th className={`${th} text-right`}>Avg Building Dmg</th>
                  <th className={`${th} text-right`}>Total Kills</th>
                  <th className={th}>Last attended</th>
                </tr>
              </thead>
              <tbody>
                {trackerRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-ink-dim">
                      {leagueCount === 0 ? "No leagues yet — add one to start tracking." : "No matching players."}
                    </td>
                  </tr>
                )}
                {trackerRows.map((p) => {
                  const pct = leagueCount > 0 ? Math.round((p.attended / leagueCount) * 100) : 0;
                  const open = expandedPlayer === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr
                        onClick={() => setExpandedPlayer(open ? null : p.id)}
                        className={[
                          "cursor-pointer border-b border-border-soft hover:bg-panel-alt/60",
                          p.active === 1 ? "" : "opacity-50",
                        ].join(" ")}
                      >
                        <td className={td}>
                          <span className="font-medium text-heading">{p.ign}</span>
                          <span className="ml-2 text-sm text-ink-dim">{p.class ?? ""}</span>
                        </td>
                        <td className={td}>
                          {leagueCount === 0 ? (
                            <span className="text-ink-dim">—</span>
                          ) : (
                            <>
                              <span className={attendanceColor(pct)}>
                                {p.attended}/{leagueCount}
                              </span>
                              <span className="ml-2 text-sm text-ink-dim">{pct}%</span>
                              {p.missedLatest && (
                                <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">
                                  missed latest
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono`}>{formatCount(p.averages.kills)}</td>
                        <td className={`${td} text-right font-mono`}>{formatCount(p.averages.assists)}</td>
                        <td className={`${td} text-right font-mono text-gold`}>{formatStat(p.averages.playerDamage)}</td>
                        <td className={`${td} text-right font-mono text-gold`}>{formatStat(p.averages.buildingDamage)}</td>
                        <td className={`${td} text-right font-mono`}>{formatCount(p.totals.kills)}</td>
                        <td className={`${td} text-ink-dim`}>{formatDate(p.lastAttended)}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border-soft bg-panel">
                          <td colSpan={8} className="px-8 py-4">
                            {p.history.length === 0 ? (
                              <p className="text-sm text-ink-dim">No league attendance recorded.</p>
                            ) : (
                              <table className="w-full max-w-3xl text-sm">
                                <thead>
                                  <tr className="text-left text-xs uppercase tracking-wide text-ink-dim">
                                    <th className="py-1 font-medium">League</th>
                                    <th className="py-1 text-right font-medium">Kills</th>
                                    <th className="py-1 text-right font-medium">Assists</th>
                                    <th className="py-1 text-right font-medium">Player Dmg</th>
                                    <th className="py-1 text-right font-medium">Building Dmg</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.history.map((h) => (
                                    <tr key={h.leagueId} className="border-t border-border-soft">
                                      <td className="py-1.5 text-ink">{formatDate(h.date)}</td>
                                      <td className="py-1.5 text-right font-mono">{formatCount(h.kills)}</td>
                                      <td className="py-1.5 text-right font-mono">{formatCount(h.assists)}</td>
                                      <td className="py-1.5 text-right font-mono text-gold">{formatStat(h.playerDamage)}</td>
                                      <td className="py-1.5 text-right font-mono text-gold">{formatStat(h.buildingDamage)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[800px] border-collapse text-base">
            <thead>
              <tr className="border-b border-border bg-panel-alt text-left text-sm uppercase tracking-wide text-ink-dim">
                <th className={th}>Date</th>
                <th className={th}>Result</th>
                <th className={`${th} text-right`}>Participants</th>
                <th className={`${th} text-right`}>Total Kills</th>
                <th className={`${th} text-right`}>Towers</th>
                <th className={`${th} text-right`}>Roster players recorded</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {leagues.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-ink-dim">
                    No leagues yet — add one to start tracking.
                  </td>
                </tr>
              )}
              {leagues.map((l) => {
                const open = expandedLeague?.id === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr
                      onClick={() => toggleLeague(l.id)}
                      className="cursor-pointer border-b border-border-soft hover:bg-panel-alt/60"
                    >
                      <td className={`${td} font-medium text-heading`}>{formatDate(l.date)}</td>
                      <td className={td}>
                        <ResultBadge result={l.result} />
                      </td>
                      <td className={`${td} text-right font-mono`}>{formatCount(l.participants)}</td>
                      <td className={`${td} text-right font-mono`}>{formatCount(l.total_kills)}</td>
                      <td className={`${td} text-right font-mono`}>{formatCount(l.towers)}</td>
                      <td className={`${td} text-right font-mono`}>{l.recorded}</td>
                      <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                        {confirmDeleteId === l.id ? (
                          <button
                            type="button"
                            autoFocus
                            onClick={() => deleteLeague(l.id)}
                            onBlur={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-danger bg-danger/15 px-3 py-1 text-sm text-danger"
                          >
                            Confirm delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(l.id)}
                            className="rounded-lg border border-border px-3 py-1 text-sm text-ink-dim hover:border-danger hover:text-danger"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border-soft bg-panel">
                        <td colSpan={7} className="px-8 py-4">
                          <table className="w-full max-w-4xl text-sm">
                            <thead>
                              <tr className="text-left text-xs uppercase tracking-wide text-ink-dim">
                                <th className="py-1 font-medium">Player</th>
                                <th className="py-1 text-right font-medium">Kills</th>
                                <th className="py-1 text-right font-medium">Assists</th>
                                <th className="py-1 text-right font-medium">Player Dmg</th>
                                <th className="py-1 text-right font-medium">Building Dmg</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedLeague.stats.map((s) => (
                                <tr key={s.playerId} className="border-t border-border-soft">
                                  <td className="py-1.5">
                                    <span className="text-heading">{s.rosterIgn}</span>
                                    {s.ign !== s.rosterIgn && (
                                      <span className="ml-2 text-xs text-ink-dim">as “{s.ign}”</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 text-right font-mono">{formatCount(s.kills)}</td>
                                  <td className="py-1.5 text-right font-mono">{formatCount(s.assists)}</td>
                                  <td className="py-1.5 text-right font-mono text-gold">{formatStat(s.playerDamage)}</td>
                                  <td className="py-1.5 text-right font-mono text-gold">{formatStat(s.buildingDamage)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddLeagueModal
          players={players}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setTab("leagues");
            load();
          }}
        />
      )}
    </div>
  );
}
