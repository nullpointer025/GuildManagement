import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { LeagueField, LeaguePreviewRow, LeagueSession, LeagueResult, Player, RawLeagueRow } from "../types";
import { CsvDropzone } from "./CsvDropzone";
import { RosterPlayerSelect } from "./RosterPlayerSelect";
import { formatCount, formatStat, todayIso } from "../lib/format";
import { guildsInFile, LEAGUE_STATS, readBattleRecordFile, readBattleRecordText } from "../lib/battleRecord";
import { useAuthStore } from "../store/auth";

interface AddLeagueModalProps {
  players: Player[];
  onSaved: (field: LeagueField) => void;
  onClose: () => void;
}

type Step = "input" | "review";
// The exporter gives the battle record as an .xlsx file or copies it to the clipboard.
type Source = "file" | "paste";

interface ReviewRow extends LeaguePreviewRow {
  // "" = not picked yet, "ignore" = leave this row out, otherwise a player id.
  pick: string;
  autoMatched: boolean;
}

interface LoadedFile {
  name: string;
  rows: RawLeagueRow[];
  guilds: { name: string; count: number }[];
}

// Stats shown in the review table; the rest are saved too.
const REVIEW_STATS = LEAGUE_STATS.filter((s) =>
  ["kills", "assists", "playerDamage", "buildingDamage", "heal", "deaths"].includes(s.key)
);

const inputClass =
  "w-full rounded-lg border border-border bg-panel-alt px-3 py-2 text-base text-ink outline-none focus:border-gold";
const labelClass = "text-xs uppercase tracking-wide text-ink-dim";

function choiceClass(selected: boolean) {
  return [
    "rounded-lg border px-4 py-2.5 text-base transition-colors",
    selected ? "border-gold bg-gold/15 font-semibold text-gold" : "border-border text-ink-dim hover:border-gold/50 hover:text-ink",
  ].join(" ");
}

export function AddLeagueModal({ players, onSaved, onClose }: AddLeagueModalProps) {
  const guildName = useAuthStore((s) => s.guild?.name);
  const [step, setStep] = useState<Step>("input");
  const [field, setField] = useState<LeagueField | null>(null);
  // How many guild leagues were fought that day (asked first), then which one this is.
  const [leaguesThatDay, setLeaguesThatDay] = useState<1 | 2 | null>(null);
  const [session, setSession] = useState<LeagueSession | null>(null);
  const [date, setDate] = useState(todayIso());
  const [result, setResult] = useState<LeagueResult | "">("");
  const [opponent, setOpponent] = useState("");
  const [source, setSource] = useState<Source>("file");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [ourGuild, setOurGuild] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const rosterOptions = useMemo(
    () => [...players].sort((a, b) => b.active - a.active || a.ign.localeCompare(b.ign)),
    [players]
  );

  const ourRows = useMemo(() => (file && ourGuild ? file.rows.filter((r) => r.guild === ourGuild) : []), [file, ourGuild]);

  // Picking our guild fills in the enemy guild: the other guild in the battle record.
  function chooseGuild(loaded: LoadedFile, name: string) {
    setOurGuild(name);
    const others = loaded.guilds.filter((g) => g.name !== name);
    setOpponent(others.length === 1 ? others[0].name : "");
  }

  function loadRows(name: string, fileRows: RawLeagueRow[]) {
    const { guilds, suggested } = guildsInFile(fileRows, guildName);
    const loaded = { name, rows: fileRows, guilds };
    setFile(loaded);
    if (suggested) chooseGuild(loaded, suggested);
    else {
      setOurGuild(null);
      setOpponent("");
    }
  }

  function clearRows(err: unknown, fallback: string) {
    setFile(null);
    setOurGuild(null);
    setError(err instanceof Error ? err.message : fallback);
  }

  function switchSource(next: Source) {
    if (next === source) return;
    setSource(next);
    setFile(null);
    setOurGuild(null);
    setPasted("");
    setError(null);
  }

  async function handleFile(f: File) {
    setError(null);
    setBusy(true);
    try {
      loadRows(f.name, await readBattleRecordFile(f));
    } catch (err) {
      clearRows(err, "Couldn't read the file");
    } finally {
      setBusy(false);
    }
  }

  function handlePaste(text: string) {
    setPasted(text);
    setError(null);
    if (!text.trim()) {
      setFile(null);
      setOurGuild(null);
      return;
    }
    try {
      loadRows("the pasted battle record", readBattleRecordText(text));
    } catch (err) {
      clearRows(err, "Couldn't read the pasted battle record");
    }
  }

  async function pasteFromClipboard() {
    try {
      handlePaste(await navigator.clipboard.readText());
    } catch {
      setError("The browser blocked reading the clipboard — click the box below and press Ctrl+V instead");
    }
  }

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const { rows } = await api.previewLeague(ourRows);
      setRows(
        rows.map((r) => ({ ...r, pick: r.playerId != null ? String(r.playerId) : "", autoMatched: r.playerId != null }))
      );
      setStep("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read the battle record");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const kept = rows.filter((r) => r.pick !== "ignore");
  const unpicked = kept.filter((r) => r.pick === "").length;
  const unreadable = kept.filter((r) => r.error).length;
  const pickCounts = kept.reduce<Record<string, number>>((acc, r) => {
    if (r.pick) acc[r.pick] = (acc[r.pick] ?? 0) + 1;
    return acc;
  }, {});
  const duplicatePicks = Object.values(pickCounts).some((n) => n > 1);
  const canSave = kept.length > 0 && unreadable === 0 && !duplicatePicks && !busy && field != null;
  const canReview = session != null && field != null && ourRows.length > 0 && !busy;

  async function save() {
    if (!field || !session) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveLeague({
        date,
        session,
        field,
        opponent,
        result: result || null,
        // Our guild's participants and total kills come straight from the battle record.
        participants: String(ourRows.length),
        totalKills: String(ourRows.reduce((t, r) => t + (Number(r.kills) || 0), 0)),
        rows: kept.map(({ pick, autoMatched: _a, error: _e, playerId: _p, ...line }) => ({ ...line, playerId: pick ? Number(pick) : null })),
      });
      onSaved(field);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the league");
    } finally {
      setBusy(false);
    }
  }

  const fieldLabel = field === "main" ? "Main field" : field === "sub" ? "Sub field" : "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-heading">
              {step === "input" ? "Add guild league" : `Review battle record · ${fieldLabel}`}
            </h2>
            <p className="text-xs text-ink-dim">
              {step === "input"
                ? "Step 1 of 2 — the field, the battle record and league details"
                : "Step 2 of 2 — check each row's roster player, then save"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === "input" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <label className="flex flex-col gap-2">
                <span className={labelClass}>Date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </label>
              <div className="flex flex-col gap-2">
                <span className={labelClass}>How many guild leagues were fought that day?</span>
                <div className="flex gap-2">
                  {([1, 2] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setLeaguesThatDay(n);
                        // With one league that day, this record is from it; with two, ask which.
                        setSession(n === 1 ? 1 : null);
                      }}
                      className={choiceClass(leaguesThatDay === n)}
                    >
                      {n} guild league{n === 1 ? "" : "s"}
                    </button>
                  ))}
                </div>
              </div>
              {leaguesThatDay === 2 && (
                <div className="flex flex-col gap-2">
                  <span className={labelClass}>Which one is this battle record from?</span>
                  <div className="flex gap-2">
                    {(
                      [
                        [1, "1st guild league"],
                        [2, "2nd guild league"],
                      ] as const
                    ).map(([value, text]) => (
                      <button key={value} type="button" onClick={() => setSession(value)} className={choiceClass(session === value)}>
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {leaguesThatDay === 2 && (
              <p className="-mt-2 text-xs text-ink-dim">
                Upload every Main and Sub export of the same league under the same choice — attendance counts each guild
                league once.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <span className={labelClass}>Which field is this battle record from?</span>
              <div className="flex gap-2">
                {(
                  [
                    ["main", "Main field"],
                    ["sub", "Sub field"],
                  ] as const
                ).map(([value, text]) => (
                  <button key={value} type="button" onClick={() => setField(value)} className={choiceClass(field === value)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>


            <div className="flex flex-col gap-2">
              <span className={labelClass}>Battle record</span>
              <div className="flex gap-1 self-start rounded-lg border border-border p-1">
                {(
                  [
                    ["file", "From file (.xlsx / .csv)"],
                    ["paste", "From clipboard"],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => switchSource(value)}
                    className={[
                      "rounded-md px-3 py-1.5 text-sm",
                      source === value ? "bg-gold font-semibold text-bg" : "text-ink-dim hover:text-ink",
                    ].join(" ")}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {source === "file" ? (
                <CsvDropzone
                  onFiles={(files) => handleFile(files[0])}
                  busy={busy}
                  compact
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  icon="📊"
                  label={file ? `Loaded ${file.name} — drop another to replace` : "Drag & drop the battle-record .xlsx or .csv here"}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-ink-dim">
                      Copy the battle record in the exporter (header row included), then paste it here.
                    </p>
                    <button
                      type="button"
                      onClick={pasteFromClipboard}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-ink hover:border-gold hover:text-gold"
                    >
                      📋 Paste from clipboard
                    </button>
                  </div>
                  <textarea
                    value={pasted}
                    onChange={(e) => handlePaste(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    placeholder={"Guild\tPlayer\tJob\tKill\tAssist\tPlayer Damage\tBuilding Damage\t…\n…or press Ctrl+V here"}
                    className="w-full resize-y whitespace-pre rounded-lg border border-border bg-panel-alt px-3 py-2 font-mono text-sm text-ink outline-none focus:border-gold"
                  />
                </div>
              )}
            </div>

            {file && (
              <div className="flex flex-col gap-2 rounded-xl border border-border-soft bg-panel-alt p-4">
                <p className="text-sm text-ink-dim">
                  {file.rows.length} players in {source === "file" ? "the file" : "the pasted battle record"}.{" "}
                  {ourGuild
                    ? "Only your guild's players are imported."
                    : `No guild in the file is named “${guildName ?? "?"}” — pick which one is yours.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {file.guilds.map((g) => (
                    <button key={g.name} type="button" onClick={() => chooseGuild(file, g.name)} className={choiceClass(ourGuild === g.name)}>
                      {g.name}
                      <span className="ml-2 text-sm font-normal text-ink-dim">{g.count} players</span>
                      {ourGuild === g.name && <span className="ml-2 text-sm">· your guild</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="col-span-2 flex flex-col gap-1">
                <span className={labelClass}>Enemy guild name</span>
                <input
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  list="enemy-guilds"
                  placeholder="The guild you fought"
                  className={inputClass}
                />
                <datalist id="enemy-guilds">
                  {file?.guilds.filter((g) => g.name !== ourGuild).map((g) => <option key={g.name} value={g.name} />)}
                </datalist>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Result</span>
                <select value={result} onChange={(e) => setResult(e.target.value as LeagueResult | "")} className={inputClass}>
                  <option value="">—</option>
                  <option value="victory">Victory</option>
                  <option value="defeat">Defeat</option>
                </select>
              </label>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="shrink-0 px-4 pt-3 text-sm text-ink-dim">
              {rows.length} {ourGuild} players · <span className="text-success">{rows.filter((r) => r.autoMatched).length} matched automatically</span>
              {unpicked > 0 && (
                <span className="text-gold">
                  {" "}
                  · {unpicked} not in the roster yet — saved and linked automatically after the next roster upload
                </span>
              )}
              {rows.length - kept.length > 0 && <span> · {rows.length - kept.length} ignored</span>}
            </p>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-dim">
                    <th className="px-2 py-2 font-medium">Name in file</th>
                    <th className="px-2 py-2 font-medium">Roster player</th>
                    {REVIEW_STATS.map((s) => (
                      <th key={s.key} className="px-2 py-2 text-right font-medium">
                        {s.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const ignored = r.pick === "ignore";
                    const clash = r.pick && !ignored && pickCounts[r.pick] > 1;
                    return (
                      <tr key={i} className={["border-b border-border-soft", ignored ? "opacity-40" : ""].join(" ")}>
                        <td className="px-2 py-1.5">
                          <span className="text-heading">{r.ign}</span>
                          {r.job && <span className="ml-2 text-xs text-ink-dim">{r.job}</span>}
                          {r.error && <p className="text-xs text-danger">{r.error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <RosterPlayerSelect
                            value={r.pick}
                            players={rosterOptions}
                            onChange={(pick) => updateRow(i, { pick, autoMatched: false })}
                            emptyLabel="Not in roster yet"
                            className={[
                              "w-52 rounded-md border bg-panel-alt px-2 py-1 text-sm text-ink outline-none focus:border-gold",
                              clash ? "border-danger" : r.pick === "" ? "border-gold/60" : r.autoMatched ? "border-success/60" : "border-border",
                            ].join(" ")}
                          />
                          {clash && <p className="text-xs text-danger">Picked for another row too</p>}
                        </td>
                        {REVIEW_STATS.map((s) => (
                          <td key={s.key} className={["px-2 py-1.5 text-right font-mono", s.big ? "text-gold" : ""].join(" ")}>
                            {s.big ? formatStat(r[s.key]) : formatCount(r[s.key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && <p className="shrink-0 px-4 pb-2 text-sm text-danger">{error}</p>}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">
          {step === "review" && (
            <button
              type="button"
              onClick={() => {
                setStep("input");
                setError(null);
              }}
              className="mr-auto rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-ink hover:text-ink"
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-ink hover:text-ink"
          >
            Cancel
          </button>
          {step === "input" ? (
            <button
              type="button"
              onClick={preview}
              disabled={!canReview}
              title={
                leaguesThatDay == null
                  ? "Pick how many guild leagues were fought that day"
                  : session == null
                    ? "Pick which guild league this battle record is from"
                    : field == null
                      ? "Pick Main field or Sub field"
                      : ourRows.length === 0
                        ? "Load the battle record and pick your guild"
                        : undefined
              }
              className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Reading…" : "Review →"}
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={
                duplicatePicks
                    ? "A roster player is picked twice"
                    : unreadable > 0
                      ? "Ignore the rows flagged in red"
                      : undefined
              }
              className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : `Save ${fieldLabel} league (${kept.length} players)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
