import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type {
  ApplyPermaPartiesResult,
  PermaParty,
  PermaPartyAssignment,
  Player,
  RaidBoardKey,
  RaidDetail,
} from "../types";
import { getClassColor } from "../lib/classColors";
import { boardLabel, type BoardInfo } from "../lib/raidTypes";

interface PermaPartiesModalProps {
  players: Player[];
  boards: RaidDetail["boards"];
  // The raid's boards, in tab order, offered as apply targets.
  boardOptions: BoardInfo[];
  defaultBoard: RaidBoardKey;
  onApply: (board: RaidBoardKey, assignments: PermaPartyAssignment[]) => Promise<ApplyPermaPartiesResult>;
  onClose: () => void;
}

interface Draft {
  id: number | null;
  name: string;
  members: Player[];
}

const MAX_MEMBERS = 5;

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function MemberChip({ player, onRemove }: { player: Player; onRemove?: () => void }) {
  const left = player.active !== 1;
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-md border border-border-soft bg-panel-alt px-2 py-1 text-sm",
        left ? "text-ink-dim line-through" : "text-ink",
      ].join(" ")}
      title={left ? "Not in the latest roster export — skipped when applied" : (player.class ?? undefined)}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: getClassColor(player.class) }} />
      {player.ign}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-ink-dim hover:text-danger"
          aria-label={`Remove ${player.ign}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

// "→ Party N" dropdown for one selected perma party, limited to the board's parties,
// with a warning when the chosen party already has other players in it.
function TargetPicker({
  value,
  parties,
  names,
  permaParty,
  clash,
  onChange,
}: {
  value: number;
  parties: (Player | null)[][];
  names: (string | null)[];
  permaParty: PermaParty;
  clash: boolean;
  onChange: (partyIndex: number) => void;
}) {
  const own = new Set(permaParty.members.map((m) => m.id));
  const replaced = (parties[value] ?? []).filter((m) => m != null && !own.has(m.id)).length;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-dim">→</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={[
          "rounded-lg border bg-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-gold",
          clash ? "border-danger" : "border-border",
        ].join(" ")}
      >
        {parties.map((members, i) => {
          const filled = members.filter(Boolean).length;
          return (
            <option key={i} value={i}>
              Party {i + 1}
              {names[i] ? ` · ${names[i]}` : ""} — {filled === 0 ? "empty" : `${filled}/5`}
            </option>
          );
        })}
      </select>
      {clash ? (
        <span className="text-sm text-danger">Another selected perma party uses this party</span>
      ) : (
        replaced > 0 && (
          <span className="text-sm text-danger">
            Replaces {replaced} player{replaced === 1 ? "" : "s"} in Party {value + 1}
          </span>
        )
      )}
    </div>
  );
}

export function PermaPartiesModal({ players, boards, boardOptions, defaultBoard, onApply, onClose }: PermaPartiesModalProps) {
  const [permaParties, setPermaParties] = useState<PermaParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [board, setBoard] = useState<RaidBoardKey>(defaultBoard);
  // Target party (0-based) on `board` for each selected perma party.
  const [targets, setTargets] = useState<Record<number, number>>({});
  const boardParties = boards[board]?.parties ?? [];
  const boardNames = boards[board]?.partyNames ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .permaParties()
      .then(({ permaParties }) => setPermaParties(permaParties))
      .catch((err) => setError(errorText(err, "Couldn't load perma parties")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Players who can still join the draft: active, not in the draft, and not already
  // in a different perma party (a player can belong to only one).
  const candidates = useMemo(() => {
    if (!draft) return [];
    const taken = new Set(
      permaParties.filter((pp) => pp.id !== draft.id).flatMap((pp) => pp.members.map((m) => m.id))
    );
    const inDraft = new Set(draft.members.map((m) => m.id));
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => p.active === 1 && !taken.has(p.id) && !inDraft.has(p.id))
      .filter((p) => !q || p.ign.toLowerCase().includes(q) || (p.class ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.ign.localeCompare(b.ign));
  }, [draft, permaParties, players, search]);

  function startDraft(party?: PermaParty) {
    setDraft(party ? { id: party.id, name: party.name, members: party.members } : { id: null, name: "", members: [] });
    setSearch("");
    setError(null);
    setNotice(null);
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const { permaParties } = await api.savePermaParty(draft.id, {
        name: draft.name,
        playerIds: draft.members.map((m) => m.id),
      });
      setPermaParties(permaParties);
      setDraft(null);
    } catch (err) {
      setError(errorText(err, "Couldn't save the perma party"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteParty(id: number) {
    setBusy(true);
    setError(null);
    try {
      const { permaParties } = await api.deletePermaParty(id);
      setPermaParties(permaParties);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setTargets(({ [id]: _dropped, ...rest }) => rest);
    } catch (err) {
      setError(errorText(err, "Couldn't delete the perma party"));
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  }

  // The party this perma party already sits in on the board (all active members
  // together), else the first empty party no other selection has claimed, else the
  // first unclaimed party at all.
  function defaultTarget(id: number, forBoard: RaidBoardKey, claimed: Set<number>) {
    const parties = boards[forBoard]?.parties ?? [];
    const active = permaParties.find((pp) => pp.id === id)?.members.filter((m) => m.active === 1) ?? [];
    const current = parties.findIndex(
      (party) => active.length > 0 && active.every((m) => party.some((p) => p?.id === m.id))
    );
    if (current !== -1 && !claimed.has(current)) return current;
    const free = parties.map((_, i) => i).filter((i) => !claimed.has(i));
    return free.find((i) => parties[i].every((m) => m == null)) ?? free[0] ?? 0;
  }

  function assignTargets(ids: number[], forBoard: RaidBoardKey) {
    const claimed = new Set<number>();
    const next: Record<number, number> = {};
    for (const id of ids) {
      next[id] = defaultTarget(id, forBoard, claimed);
      claimed.add(next[id]);
    }
    return next;
  }

  function toggleSelected(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      setTargets(({ [id]: _dropped, ...rest }) => rest);
    } else {
      next.add(id);
      setTargets((prev) => ({ ...prev, [id]: defaultTarget(id, board, new Set(Object.values(prev))) }));
    }
    setSelected(next);
  }

  function switchBoard(next: RaidBoardKey) {
    setBoard(next);
    const ids = permaParties.filter((pp) => selected.has(pp.id)).map((pp) => pp.id);
    setTargets(assignTargets(ids, next));
  }

  const targetList = [...selected].map((id) => targets[id]);
  const hasClash = new Set(targetList).size !== targetList.length;

  async function apply() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const assignments = permaParties
        .filter((pp) => selected.has(pp.id))
        .map((pp) => ({ permaPartyId: pp.id, partyIndex: targets[pp.id] }));
      const { skipped, alreadyPlaced } = await onApply(board, assignments);
      const placed = assignments.length - alreadyPlaced.length;
      const parts = [`Applied ${placed} perma part${placed === 1 ? "y" : "ies"} to ${boardLabel(board)}.`];
      if (alreadyPlaced.length) parts.push(`Already there: ${alreadyPlaced.join(", ")}.`);
      if (skipped.length) parts.push(`Skipped (not in latest roster): ${skipped.join(", ")}.`);
      setNotice(parts.join(" "));
      setSelected(new Set());
      setTargets({});
    } catch (err) {
      setError(errorText(err, "Couldn't apply the perma parties"));
    } finally {
      setBusy(false);
    }
  }

  const boardButton = (key: RaidBoardKey, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => switchBoard(key)}
      className={[
        "rounded-md px-3 py-1 text-sm font-semibold uppercase transition-colors",
        board === key ? "bg-gold text-bg" : "text-ink-dim hover:bg-panel-alt hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-heading">
              {draft ? (draft.id == null ? "New perma party" : "Edit perma party") : "Perma Parties"}
            </h2>
            <p className="text-xs text-ink-dim">
              Saved groups shared by every raid — kept until you delete them.
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

        {draft ? (
          <>
            <div className="flex shrink-0 flex-col gap-3 p-4">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Party name, e.g. Tank Squad"
                maxLength={60}
                className="w-full rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
              />
              <div>
                <p className="mb-2 text-sm text-ink-dim">
                  Members ({draft.members.length}/{MAX_MEMBERS})
                </p>
                <div className="flex min-h-9 flex-wrap gap-2">
                  {draft.members.length === 0 && (
                    <span className="text-sm text-ink-dim">Pick players below.</span>
                  )}
                  {draft.members.map((m) => (
                    <MemberChip
                      key={m.id}
                      player={m}
                      onRemove={() => setDraft({ ...draft, members: draft.members.filter((x) => x.id !== m.id) })}
                    />
                  ))}
                </div>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players by name or class…"
                disabled={draft.members.length >= MAX_MEMBERS}
                className="w-full rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold disabled:opacity-50"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-3">
              {draft.members.length >= MAX_MEMBERS ? (
                <p className="py-4 text-center text-sm text-ink-dim">Party is full.</p>
              ) : candidates.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-dim">No available players.</p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, members: [...draft.members, p] })}
                    className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left hover:border-gold/50 hover:bg-panel-alt"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: getClassColor(p.class) }}
                      />
                      <span className="truncate text-base text-heading">{p.ign}</span>
                      <span className="truncate text-sm text-ink-dim">{p.class ?? "—"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-sm text-gold">
                      {p.gear_score != null ? p.gear_score.toLocaleString() : "—"}
                    </span>
                  </button>
                ))
              )}
            </div>
            {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}
            <div className="flex items-center justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-ink hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDraft}
                disabled={busy || !draft.name.trim() || draft.members.length === 0}
                className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              {loading && <p className="py-6 text-center text-sm text-ink-dim">Loading…</p>}
              {!loading && permaParties.length === 0 && (
                <p className="py-6 text-center text-sm text-ink-dim">
                  No perma parties yet. Create one to reuse it in any raid.
                </p>
              )}
              {permaParties.map((pp) => (
                <div
                  key={pp.id}
                  className={[
                    "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                    selected.has(pp.id) ? "border-gold/60 bg-gold/5" : "border-border-soft bg-panel-alt",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(pp.id)}
                    onChange={() => toggleSelected(pp.id)}
                    aria-label={`Select ${pp.name}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#d9a441]"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => toggleSelected(pp.id)}
                      className="text-left text-base font-semibold text-heading"
                    >
                      {pp.name} <span className="text-sm font-normal text-ink-dim">({pp.members.length}/5)</span>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pp.members.map((m) => (
                        <MemberChip key={m.id} player={m} />
                      ))}
                    </div>
                    {selected.has(pp.id) && (
                      <TargetPicker
                        value={targets[pp.id] ?? 0}
                        parties={boardParties}
                        names={boardNames}
                        permaParty={pp}
                        clash={targetList.filter((t) => t === targets[pp.id]).length > 1}
                        onChange={(partyIndex) => setTargets((prev) => ({ ...prev, [pp.id]: partyIndex }))}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startDraft(pp)}
                      className="rounded-lg border border-border px-3 py-1 text-sm text-ink-dim hover:border-gold hover:text-gold"
                    >
                      Edit
                    </button>
                    {confirmDeleteId === pp.id ? (
                      <button
                        type="button"
                        onClick={() => deleteParty(pp.id)}
                        onBlur={() => setConfirmDeleteId(null)}
                        disabled={busy}
                        autoFocus
                        className="rounded-lg border border-danger bg-danger/15 px-3 py-1 text-sm text-danger"
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(pp.id)}
                        className="rounded-lg border border-border px-3 py-1 text-sm text-ink-dim hover:border-danger hover:text-danger"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => startDraft()}
                className="mt-1 rounded-xl border border-dashed border-border py-3 text-base text-ink-dim hover:border-gold hover:text-gold"
              >
                + New perma party
              </button>
            </div>
            {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}
            {notice && !error && <p className="px-4 pb-2 text-sm text-success">{notice}</p>}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border p-4">
              <span className="text-sm text-ink-dim">Apply {selected.size} selected to</span>
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
                {boardOptions.map((b) => boardButton(b.key, b.label))}
              </div>
              <button
                type="button"
                onClick={apply}
                disabled={busy || selected.size === 0 || hasClash}
                title={hasClash ? "Two perma parties are set to the same party" : undefined}
                className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
