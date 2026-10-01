import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { LeaguePreviewRow, LeagueResult, Player } from "../types";
import { CsvDropzone } from "./CsvDropzone";
import { formatStat, todayIso } from "../lib/format";

interface AddLeagueModalProps {
  players: Player[];
  onSaved: () => void;
  onClose: () => void;
}

// Pasted into a claude.ai chat together with the battle-record screenshots, so the
// reply comes back in exactly the format the importer reads.
const CLAUDE_PROMPT = `These screenshots are the Battle Record of one guild league in Ragnarok: The New World, scrolled from top to bottom.
Read every player row across all screenshots and reply with ONLY a CSV (no other text), using exactly this header:
Player,Kill,Assist,Player Damage,Building Damage

Rules:
- One row per player. Include every player from every screenshot.
- Skip duplicate rows: the highlighted row at the bottom of each screenshot repeats my own row, and scrolled screenshots overlap.
- Keep player names exactly as shown, including Japanese/Thai characters and symbols, but leave out icons in front of names.
- Keep numbers as shown (e.g. 12.3M, 790.0M).`;

type Step = "input" | "review";
type Source = "screenshots" | "csv";

interface ReviewRow {
  ign: string;
  // "" = not picked yet, "ignore" = leave this row out, otherwise a player id.
  pick: string;
  autoMatched: boolean;
  kills: string;
  assists: string;
  playerDamage: string;
  buildingDamage: string;
  error: string | null;
}

const inputClass =
  "w-full rounded-lg border border-border bg-panel-alt px-3 py-2 text-base text-ink outline-none focus:border-gold";
const cellInput =
  "w-24 rounded-md border border-border-soft bg-panel-alt px-2 py-1 text-right font-mono text-sm text-ink outline-none focus:border-gold";

function toReviewRow(r: LeaguePreviewRow): ReviewRow {
  return {
    ign: r.ign,
    pick: r.playerId != null ? String(r.playerId) : "",
    autoMatched: r.playerId != null,
    kills: String(r.kills ?? ""),
    assists: String(r.assists ?? ""),
    playerDamage: r.playerDamage != null ? formatStat(r.playerDamage) : "",
    buildingDamage: r.buildingDamage != null ? formatStat(r.buildingDamage) : "",
    error: r.error,
  };
}

export function AddLeagueModal({ players, onSaved, onClose }: AddLeagueModalProps) {
  const [step, setStep] = useState<Step>("input");
  const [date, setDate] = useState(todayIso());
  const [result, setResult] = useState<LeagueResult | "">("");
  const [participants, setParticipants] = useState("");
  const [totalKills, setTotalKills] = useState("");
  const [towers, setTowers] = useState("");
  const [source, setSource] = useState<Source>("screenshots");
  const [images, setImages] = useState<File[]>([]);
  const [fromOcr, setFromOcr] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  function addImages(files: File[]) {
    setImages((prev) => [...prev, ...files.filter((f) => f.type.startsWith("image/"))]);
    setError(null);
  }

  async function handleFile(file: File) {
    setCsv(await file.text());
    setFileName(file.name);
    setError(null);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the prompt text and copy it by hand");
    }
  }

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const { rows } = source === "screenshots" ? await api.previewLeagueImages(images) : await api.previewLeague(csv);
      setRows(rows.map(toReviewRow));
      setFromOcr(source === "screenshots");
      setStep("review");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : source === "screenshots" ? "Couldn't read the screenshots" : "Couldn't read the CSV"
      );
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const kept = rows.filter((r) => r.pick !== "ignore");
  const unpicked = kept.filter((r) => r.pick === "").length;
  const pickCounts = kept.reduce<Record<string, number>>((acc, r) => {
    if (r.pick) acc[r.pick] = (acc[r.pick] ?? 0) + 1;
    return acc;
  }, {});
  const duplicatePicks = Object.values(pickCounts).some((n) => n > 1);
  const canSave = kept.length > 0 && unpicked === 0 && !duplicatePicks && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveLeague({
        date,
        result: result || null,
        participants,
        totalKills,
        towers,
        rows: kept.map((r) => ({
          playerId: Number(r.pick),
          ign: r.ign,
          kills: r.kills,
          assists: r.assists,
          playerDamage: r.playerDamage,
          buildingDamage: r.buildingDamage,
        })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the league");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-heading">
              {step === "input" ? "Add guild league" : "Review battle record"}
            </h2>
            <p className="text-xs text-ink-dim">
              {step === "input"
                ? "Step 1 of 2 — league details and the battle record"
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Date</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Result</span>
                <select
                  value={result}
                  onChange={(e) => setResult(e.target.value as LeagueResult | "")}
                  className={inputClass}
                >
                  <option value="">—</option>
                  <option value="victory">Victory</option>
                  <option value="defeat">Defeat</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Participants</span>
                <input inputMode="numeric" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="59" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Total kills</span>
                <input inputMode="numeric" value={totalKills} onChange={(e) => setTotalKills(e.target.value)} placeholder="777" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">Towers</span>
                <input inputMode="numeric" value={towers} onChange={(e) => setTowers(e.target.value)} placeholder="7" className={inputClass} />
              </label>
            </div>

            <div className="flex gap-1 self-start rounded-lg border border-border p-1">
              {(
                [
                  ["screenshots", "Upload screenshots"],
                  ["csv", "Paste CSV"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSource(value);
                    setError(null);
                  }}
                  className={[
                    "rounded-md px-3 py-1.5 text-sm",
                    source === value ? "bg-gold text-bg font-semibold" : "text-ink-dim hover:text-ink",
                  ].join(" ")}
                >
                  {text}
                </button>
              ))}
            </div>

            {source === "screenshots" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-ink-dim">
                  Add every battle-record screenshot for this league, scrolled from top to bottom. They're read with
                  text recognition, so check the names and numbers on the next step.
                </p>
                <CsvDropzone
                  onFiles={addImages}
                  busy={busy}
                  compact
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  icon="🖼️"
                  label={images.length > 0 ? "Drop more screenshots to add them" : "Drag & drop the battle-record screenshots here"}
                />
                {images.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {images.map((img, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border-soft bg-panel-alt px-3 py-1.5 text-sm"
                      >
                        <span className="truncate text-ink">
                          {i + 1}. {img.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-ink-dim hover:text-danger"
                          aria-label={`Remove ${img.name}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
              <div className="rounded-xl border border-border-soft bg-panel-alt p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-heading">Turn screenshots into the CSV with Claude</p>
                    <p className="text-sm text-ink-dim">
                      Open claude.ai, attach all battle-record screenshots for this league, paste this prompt, and save the
                      reply as a .csv (or paste it below).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm text-ink hover:border-gold hover:text-gold"
                  >
                    {copied ? "Copied!" : "Copy prompt"}
                  </button>
                </div>
              </div>

              <CsvDropzone
                onFiles={(files) => handleFile(files[0])}
                busy={false}
                compact
                label={fileName ? `Loaded ${fileName} — drop another to replace` : "Drag & drop the battle-record CSV here"}
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-ink-dim">…or paste the CSV</span>
                <textarea
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setFileName(null);
                  }}
                  rows={6}
                  placeholder={"Player,Kill,Assist,Player Damage,Building Damage"}
                  className="w-full resize-y rounded-lg border border-border bg-panel-alt px-3 py-2 font-mono text-sm text-ink outline-none focus:border-gold"
                />
              </label>
              </>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="shrink-0 px-4 pt-3 text-sm text-ink-dim">
              {rows.length} rows · <span className="text-success">{rows.filter((r) => r.autoMatched).length} matched automatically</span>
              {unpicked > 0 && <span className="text-danger"> · {unpicked} need a roster player</span>}
              {rows.length - kept.length > 0 && <span> · {rows.length - kept.length} ignored</span>}
              {fromOcr && <span> · read from screenshots, so compare the numbers before saving</span>}
            </p>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-dim">
                    <th className="px-2 py-2 font-medium">Name in screenshot</th>
                    <th className="px-2 py-2 font-medium">Roster player</th>
                    <th className="px-2 py-2 text-right font-medium">Kills</th>
                    <th className="px-2 py-2 text-right font-medium">Assists</th>
                    <th className="px-2 py-2 text-right font-medium">Player dmg</th>
                    <th className="px-2 py-2 text-right font-medium">Building dmg</th>
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
                          {r.error && <p className="text-xs text-danger">{r.error}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={r.pick}
                            onChange={(e) => updateRow(i, { pick: e.target.value, autoMatched: false })}
                            className={[
                              "w-52 rounded-md border bg-panel-alt px-2 py-1 text-sm text-ink outline-none focus:border-gold",
                              (r.pick === "" || clash) ? "border-danger" : r.autoMatched ? "border-success/60" : "border-border",
                            ].join(" ")}
                          >
                            <option value="">— pick a player —</option>
                            <option value="ignore">Ignore this row</option>
                            {rosterOptions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.ign}
                                {p.active === 1 ? "" : " (left guild)"}
                              </option>
                            ))}
                          </select>
                          {clash && <p className="text-xs text-danger">Picked for another row too</p>}
                        </td>
                        {(["kills", "assists", "playerDamage", "buildingDamage"] as const).map((k) => (
                          <td key={k} className="px-2 py-1.5 text-right">
                            <input
                              value={r[k]}
                              onChange={(e) => updateRow(i, { [k]: e.target.value })}
                              disabled={ignored}
                              className={cellInput}
                            />
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
              disabled={busy || (source === "screenshots" ? images.length === 0 : !csv.trim())}
              className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (source === "screenshots" ? "Reading screenshots…" : "Reading…") : "Review →"}
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={unpicked > 0 ? "Pick a roster player (or Ignore) for every row" : duplicatePicks ? "A roster player is picked twice" : undefined}
              className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : `Save league (${kept.length} players)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
