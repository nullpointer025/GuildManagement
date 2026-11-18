import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  League,
  LeagueDetail,
  LeagueField,
  LeagueStatKey,
  LeagueStatLine,
  Player,
  TrackerData,
  TrackerPlayer,
} from "../types";
import { AddLeagueModal } from "../components/AddLeagueModal";
import { formatCount, formatDate, formatStat } from "../lib/format";
import { LEAGUE_STATS } from "../lib/battleRecord";

type Tab = "tracker" | "leagues";
type TrackerSort = "attendance" | "played" | "ign" | LeagueStatKey;

const th = "px-4 py-3 font-medium";
const td = "px-4 py-3";
const subTh = "px-2 py-1 text-right font-medium whitespace-nowrap";
const subTd = "px-2 py-1.5 text-right font-mono whitespace-nowrap";

// Averages shown as tracker columns; every stat is in the expanded history.
const TRACKER_STATS = LEAGUE_STATS.filter((s) =>
  ["kills", "assists", "playerDamage", "buildingDamage", "heal", "deaths"].includes(s.key)
);
const FIELD_LABEL: Record<LeagueField, string> = { main: "Main", sub: "Sub" };

function attendanceColor(pct: number) {
  if (pct >= 75) return "text-success";
  if (pct >= 50) return "text-gold";
  return "text-danger";
}

function statText(key: LeagueStatKey, value: number | null | undefined) {
  return LEAGUE_STATS.find((s) => s.key === key)?.big ? formatStat(value) : formatCount(value);
}

function ResultBadge({ result }: { result: League["result"] }) {
  if (!result) return <span className="text-ink-dim">—</span>;
  return result === "victory" ? (
    <span className="rounded-full bg-success/15 px-2.5 py-1 text-sm text-success">Victory</span>
  ) : (
    <span className="rounded-full bg-danger/15 px-2.5 py-1 text-sm text-danger">Defeat</span>
  );
}

function FieldBadge({ field }: { field: LeagueField }) {
  return (
    <span
      className={[
        "rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        field === "main" ? "bg-gold/15 text-gold" : "bg-panel-alt text-ink-dim ring-1 ring-border",
      ].join(" ")}
    >
      {FIELD_LABEL[field]}
    </span>
  );
}

function StatCells({ line }: { line: LeagueStatLine }) {
  return (
    <>
      {LEAGUE_STATS.map((s) => (
        <td key={s.key} className={[subTd, s.big ? "text-gold" : ""].join(" ")}>
          {statText(s.key, line[s.key])}
        </td>
      ))}
    </>
  );
}

function StatHeaders() {
  return (
    <>
      {LEAGUE_STATS.map((s) => (
        <th key={s.key} className={subTh}>
          {s.short}
        </th>
      ))}
    </>
  );
}

// A player's averages per field side by side, then every league they fought.
function PlayerHistory({ player }: { player: TrackerPlayer }) {
  if (player.history.length === 0) return <p className="text-sm text-ink-dim">No league attendance recorded.</p>;
  return (
    <div className="flex flex-col gap-5 overflow-x-auto">
      <table className="w-max text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-dim">
            <th className="py-1 pr-4 font-medium">Averages</th>
            <th className={subTh}>GLs</th>
            <StatHeaders />
          </tr>
        </thead>
        <tbody>
          {(["main", "sub"] as const).map((f) => {
            const summary = player.fields[f];
            return (
              <tr key={f} className="border-t border-border-soft">
                <td className="py-1.5 pr-4">
                  <FieldBadge field={f} />
                </td>
                <td className={subTd}>{summary.played}</td>
                {summary.played === 0 ? (
                  <td colSpan={LEAGUE_STATS.length} className="px-2 py-1.5 text-ink-dim">
                    Hasn't fought in the {FIELD_LABEL[f]} field
                  </td>
                ) : (
                  <StatCells line={summary.averages} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="w-max text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-dim">
            <th className="py-1 pr-4 font-medium">League</th>
            <th className="py-1 pr-4 font-medium">Field</th>
            <th className="py-1 pr-4 font-medium">Job</th>
            <StatHeaders />
          </tr>
        </thead>
        <tbody>
          {player.history.map((h) => (
            <tr key={h.leagueId} className="border-t border-border-soft">
              <td className="py-1.5 pr-4 whitespace-nowrap text-ink">
                {formatDate(h.date)}
                {h.opponent && <span className="ml-2 text-xs text-ink-dim">vs {h.opponent}</span>}
              </td>
              <td className="py-1.5 pr-4">
                <FieldBadge field={h.field} />
              </td>
              <td className="py-1.5 pr-4 whitespace-nowrap text-ink-dim">{h.job ?? "—"}</td>
              <StatCells line={h} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GuildLeaguePage() {
  const [tab, setTab] = useState<Tab>("tracker");
  const [tracker, setTracker] = useState<TrackerData>({ leagueDates: 0, fieldCounts: { main: 0, sub: 0 }, players: [] });
  const [leagues, setLeagues] = useState<League[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [field, setField] = useState<LeagueField>("main");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<TrackerSort>("attendance");
  const [onlyField, setOnlyField] = useState(false);
  const [onlyMissedLatest, setOnlyMissedLatest] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<number | null>(null);
  const [expandedLeague, setExpandedLeague] = useState<LeagueDetail | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, l, p] = await Promise.all([api.leagueTracker(), api.leagues(), api.players()]);
      setTracker(t);
      setLeagues(l.leagues);
      setPlayers(p.players);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const { leagueDates, fieldCounts } = tracker;

  const trackerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const value = (p: TrackerPlayer) => {
      if (sortKey === "attendance") return p.attended;
      if (sortKey === "played") return p.fields[field].played;
      if (sortKey === "ign") return 0;
      return p.fields[field].averages[sortKey] ?? -1;
    };
    return tracker.players
      .filter((p) => showLeft || p.active === 1)
      .filter((p) => !onlyMissedLatest || p.missedLatest)
      .filter((p) => !onlyField || p.fields[field].played > 0)
      .filter((p) => !q || p.ign.toLowerCase().includes(q) || (p.class ?? "").toLowerCase().includes(q))
      .sort((a, b) => (sortKey === "ign" ? a.ign.localeCompare(b.ign) : value(b) - value(a) || a.ign.localeCompare(b.ign)));
  }, [tracker, field, search, sortKey, onlyField, onlyMissedLatest, showLeft]);

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

  const missedLatestCount = tracker.players.filter((p) => p.active === 1 && p.missedLatest).length;
  const trackerCols = 4 + TRACKER_STATS.length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-heading">Guild League</h1>
          <p className="mt-1.5 text-base text-ink-dim">
            {leagueDates} league date{leagueDates === 1 ? "" : "s"} · {fieldCounts.main} Main / {fieldCounts.sub} Sub
            battle record{fieldCounts.main + fieldCounts.sub === 1 ? "" : "s"}
            {leagueDates > 0 && (
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
          + Upload battle record
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
            <div className="flex items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="Field">
              {(["main", "sub"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setField(f)}
                  className={[
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                    field === f ? "bg-gold text-bg" : "text-ink-dim hover:bg-panel-alt hover:text-ink",
                  ].join(" ")}
                >
                  {FIELD_LABEL[f]} field
                  <span className="ml-1.5 font-normal opacity-75">{fieldCounts[f]}</span>
                </button>
              ))}
            </div>
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
              <option value="played">Sort: {FIELD_LABEL[field]} GLs fought</option>
              {LEAGUE_STATS.map((s) => (
                <option key={s.key} value={s.key}>
                  Sort: Avg {s.label}
                </option>
              ))}
              <option value="ign">Sort: Name</option>
            </select>
          </div>
          <div className="-mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2.5 text-base text-ink-dim">
              <input type="checkbox" checked={onlyField} onChange={(e) => setOnlyField(e.target.checked)} className="h-4 w-4 accent-[#d9a441]" />
              Only players who fought in the {FIELD_LABEL[field]} field
            </label>
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
              <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} className="h-4 w-4 accent-[#d9a441]" />
              Show members who left
            </label>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[1100px] border-collapse text-base">
              <thead>
                <tr className="border-b border-border bg-panel-alt text-left text-sm uppercase tracking-wide text-ink-dim">
                  <th className={th}>Player</th>
                  <th className={th}>Attendance</th>
                  <th className={`${th} text-right`}>{FIELD_LABEL[field]} GLs</th>
                  {TRACKER_STATS.map((s) => (
                    <th key={s.key} className={`${th} text-right`}>
                      Avg {s.short}
                    </th>
                  ))}
                  <th className={th}>Last attended</th>
                </tr>
              </thead>
              <tbody>
                {trackerRows.length === 0 && (
                  <tr>
                    <td colSpan={trackerCols} className="px-5 py-10 text-center text-ink-dim">
                      {leagueDates === 0 ? "No leagues yet — upload a battle record to start tracking." : "No matching players."}
                    </td>
                  </tr>
                )}
                {trackerRows.map((p) => {
                  const pct = leagueDates > 0 ? Math.round((p.attended / leagueDates) * 100) : 0;
                  const open = expandedPlayer === p.id;
                  const summary = p.fields[field];
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
                        <td className={`${td} whitespace-nowrap`}>
                          {leagueDates === 0 ? (
                            <span className="text-ink-dim">—</span>
                          ) : (
                            <>
                              <span className={attendanceColor(pct)}>
                                {p.attended}/{leagueDates}
                              </span>
                              <span className="ml-2 text-sm text-ink-dim">{pct}%</span>
                              {p.missedLatest && (
                                <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">missed latest</span>
                              )}
                              <div className="text-xs text-ink-dim">
                                Main {p.fields.main.played} · Sub {p.fields.sub.played}
                              </div>
                            </>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono`}>{summary.played || <span className="text-ink-dim">—</span>}</td>
                        {TRACKER_STATS.map((s) => (
                          <td key={s.key} className={[td, "text-right font-mono", s.big ? "text-gold" : ""].join(" ")}>
                            {statText(s.key, summary.averages[s.key])}
                          </td>
                        ))}
                        <td className={`${td} whitespace-nowrap text-ink-dim`}>{formatDate(p.lastAttended)}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border-soft bg-panel">
                          <td colSpan={trackerCols} className="max-w-0 px-8 py-4">
                            <PlayerHistory player={p} />
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
          <table className="w-full min-w-[900px] border-collapse text-base">
            <thead>
              <tr className="border-b border-border bg-panel-alt text-left text-sm uppercase tracking-wide text-ink-dim">
                <th className={th}>Date</th>
                <th className={th}>Field</th>
                <th className={th}>Opponent</th>
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
                  <td colSpan={9} className="px-5 py-10 text-center text-ink-dim">
                    No leagues yet — upload a battle record to start tracking.
                  </td>
                </tr>
              )}
              {leagues.map((l) => {
                const open = expandedLeague?.id === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr onClick={() => toggleLeague(l.id)} className="cursor-pointer border-b border-border-soft hover:bg-panel-alt/60">
                      <td className={`${td} font-medium text-heading`}>{formatDate(l.date)}</td>
                      <td className={td}>
                        <FieldBadge field={l.field} />
                      </td>
                      <td className={`${td} text-ink`}>{l.opponent ?? <span className="text-ink-dim">—</span>}</td>
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
                        <td colSpan={9} className="max-w-0 px-8 py-4">
                          <div className="overflow-x-auto">
                            <table className="w-max text-sm">
                              <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-ink-dim">
                                  <th className="py-1 pr-4 font-medium">Player</th>
                                  <th className="py-1 pr-4 font-medium">Job</th>
                                  <StatHeaders />
                                </tr>
                              </thead>
                              <tbody>
                                {expandedLeague.stats.map((s) => (
                                  <tr key={s.playerId} className="border-t border-border-soft">
                                    <td className="py-1.5 pr-4 whitespace-nowrap">
                                      <span className="text-heading">{s.rosterIgn}</span>
                                      {s.ign !== s.rosterIgn && <span className="ml-2 text-xs text-ink-dim">as “{s.ign}”</span>}
                                    </td>
                                    <td className="py-1.5 pr-4 whitespace-nowrap text-ink-dim">{s.job ?? s.class ?? "—"}</td>
                                    <StatCells line={s} />
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
          onSaved={(savedField) => {
            setAdding(false);
            setField(savedField);
            load();
          }}
        />
      )}
    </div>
  );
}
