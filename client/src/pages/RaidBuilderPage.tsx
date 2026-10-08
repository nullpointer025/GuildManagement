import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api } from "../api/client";
import type { AutoAssignRole, PermaPartyAssignment, Player, RaidBoardKey, RaidDetail } from "../types";
import type { DragOrigin } from "../components/DraggablePlayer";
import { PoolPanel } from "../components/PoolPanel";
import { Party } from "../components/Party";
import { ExportParty } from "../components/ExportParty";
import { PlayerCard } from "../components/PlayerCard";
import { PlayerPickerModal } from "../components/PlayerPickerModal";
import { NotesModal } from "../components/NotesModal";
import { PermaPartiesModal } from "../components/PermaPartiesModal";
import { ClassCounter } from "../components/ClassCounter";
import { ActionsModal, type RaidAction } from "../components/ActionsModal";
import { RAID_TYPE_BOARDS, boardLabel } from "../lib/raidTypes";

type SortKey = "gear_score" | "level" | "ign" | "class";

const AUTO_ASSIGN_LABELS: Record<AutoAssignRole, { one: string; many: string }> = {
  priest: { one: "priest", many: "priests" },
  clown_gypsy: { one: "clown/gypsy", many: "clowns/gypsies" },
};

const RAID_ACTIONS: RaidAction[] = [
  {
    key: "parties",
    label: "Auto assign parties",
    description: "Fill each party with a High Priest, Clown/Gypsy, Creator and 2 DPS of different classes.",
  },
  { key: "priest", label: "Auto assign priest", description: "Give every party without a priest the best free one." },
  {
    key: "clown_gypsy",
    label: "Auto assign clown/gypsy",
    description: "Give every party without a clown or gypsy the best free one.",
  },
];

export function RaidBuilderPage() {
  const { id } = useParams();
  const raidId = Number(id);
  const navigate = useNavigate();

  const [raid, setRaid] = useState<RaidDetail | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBoard, setActiveBoard] = useState<RaidBoardKey>("main");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gear_score");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [activeDrag, setActiveDrag] = useState<Player | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState(1);
  const [exportTo, setExportTo] = useState(8);
  const [pickerTarget, setPickerTarget] = useState<{ partyIndex: number; slotIndex: number } | null>(
    null
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesUnseen, setNotesUnseen] = useState(false);
  const [permaOpen, setPermaOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [autoAssignNotice, setAutoAssignNotice] = useState<string | null>(null);
  // Everyone in a perma party — kept out of the pool, since they're placed by
  // applying their perma party rather than one by one.
  const [permaMemberIds, setPermaMemberIds] = useState<Set<number>>(new Set());
  const exportRef = useRef<HTMLDivElement>(null);
  const notesSeenKey = `guild-notes-seen-${raidId}`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [raidRes, playersRes] = await Promise.all([api.getRaid(raidId), api.players()]);
      if (cancelled) return;
      setRaid(raidRes.raid);
      setNameDraft(raidRes.raid.name);
      setPlayers(playersRes.players);
      setActiveBoard(RAID_TYPE_BOARDS[raidRes.raid.type][0].key);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [raidId]);

  async function loadPermaMembers() {
    const { permaParties } = await api.permaParties();
    setPermaMemberIds(new Set(permaParties.flatMap((pp) => pp.members.map((m) => m.id))));
  }

  useEffect(() => {
    loadPermaMembers();
  }, []);

  useEffect(() => {
    setAutoAssignNotice(null);
  }, [activeBoard]);

  // Keep the export range in sync with the active board's actual party count,
  // without clobbering a smaller range the officer deliberately picked.
  const activeBoardPartyCount = raid?.boards[activeBoard]?.parties.length;
  useEffect(() => {
    if (!activeBoardPartyCount) return;
    setExportTo((prev) => Math.min(prev, activeBoardPartyCount) || activeBoardPartyCount);
    setExportFrom((prev) => Math.min(prev, activeBoardPartyCount) || 1);
  }, [activeBoardPartyCount]);

  // Live sync: pick up other officers' edits to this raid. Skipped while the
  // export overlay is up or while someone's actively typing, so a poll never
  // interrupts a capture or clobbers an in-progress edit.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (exporting) return;
      const active = document.activeElement;
      const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (isTyping) return;
      try {
        const { raid: updated } = await api.getRaid(raidId);
        setRaid(updated);
      } catch {
        // transient network hiccup — next tick will retry
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [raidId, exporting]);

  // Keep the raid-name field showing the latest server value once it's changed
  // elsewhere, but never while the officer is actively editing it here.
  useEffect(() => {
    if (raid && document.activeElement?.id !== "raid-name-input") {
      setNameDraft(raid.name);
    }
  }, [raid?.name]);

  // Flag the Notes button whenever the notes have changed since this browser
  // last viewed them — there are no accounts, so "seen" is tracked per device.
  useEffect(() => {
    if (!raid?.notes_updated_at) return;
    const seen = localStorage.getItem(notesSeenKey);
    setNotesUnseen(raid.notes_updated_at !== seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raid?.notes_updated_at]);

  const classOptions = useMemo(() => {
    const classes = new Set(
      players.filter((p) => p.active === 1 && p.class).map((p) => p.class as string)
    );
    return Array.from(classes).sort((a, b) => a.localeCompare(b));
  }, [players]);

  const pool = useMemo(() => {
    if (!raid) return [];
    // A player assigned on any board is unavailable on all of them — every board shares one pool.
    // Perma party members never show here either.
    const assigned = new Set([
      ...Object.values(raid.boards)
        .flatMap((b) => b.parties.flat())
        .filter(Boolean)
        .map((p) => (p as Player).id),
      ...permaMemberIds,
    ]);
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => p.active === 1 && !assigned.has(p.id))
      .filter((p) => classFilter === "all" || p.class === classFilter)
      .filter((p) => {
        if (!q) return true;
        return p.ign.toLowerCase().includes(q) || (p.class ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortKey === "ign") return a.ign.localeCompare(b.ign);
        if (sortKey === "class") {
          const byClass = (a.class ?? "").localeCompare(b.class ?? "");
          return byClass !== 0 ? byClass : (b.gear_score ?? -1) - (a.gear_score ?? -1);
        }
        return (b[sortKey] ?? -1) - (a[sortKey] ?? -1);
      });
  }, [raid, players, permaMemberIds, search, sortKey, classFilter]);

  async function setSlot(partyIndex: number, slotIndex: number, playerId: number | null) {
    const { raid: updated } = await api.setSlot(raidId, {
      board: activeBoard,
      partyIndex,
      slotIndex,
      playerId,
    });
    setRaid(updated);
    return updated;
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { player: Player } | undefined;
    setActiveDrag(data?.player ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over || !raid) return;

    const activeData = active.data.current as { player: Player; from: DragOrigin } | undefined;
    const overData = over.data.current as
      | { type: "pool" }
      | { type: "slot"; partyIndex: number; slotIndex: number }
      | undefined;
    if (!activeData || !overData) return;

    if (overData.type === "pool") {
      if (activeData.from.type === "slot") {
        await setSlot(activeData.from.partyIndex, activeData.from.slotIndex, null);
      }
      return;
    }

    const { partyIndex, slotIndex } = overData;
    if (
      activeData.from.type === "slot" &&
      activeData.from.partyIndex === partyIndex &&
      activeData.from.slotIndex === slotIndex
    ) {
      return;
    }

    const occupant = raid.boards[activeBoard]?.parties[partyIndex]?.[slotIndex] ?? null;
    await setSlot(partyIndex, slotIndex, activeData.player.id);

    if (occupant && activeData.from.type === "slot") {
      await setSlot(activeData.from.partyIndex, activeData.from.slotIndex, occupant.id);
    }
  }

  async function handlePartyCountChange(delta: number) {
    const current = raid?.boards[activeBoard]?.parties.length;
    if (!current) return;
    const next = current + delta;
    if (next < 1 || next > 50) return;
    const { raid: updated } = await api.updatePartyCount(raidId, activeBoard, next);
    setRaid(updated);
  }

  async function commitName() {
    if (!raid || !nameDraft.trim() || nameDraft === raid.name) {
      if (raid) setNameDraft(raid.name);
      return;
    }
    const { raid: updated } = await api.updateRaid(raidId, { name: nameDraft.trim() });
    setRaid(updated);
  }

  async function handleRenameParty(partyIndex: number, name: string) {
    const { raid: updated } = await api.renameParty(raidId, partyIndex, activeBoard, name);
    setRaid(updated);
  }

  async function handlePickPlayer(player: Player) {
    if (!pickerTarget) return;
    await setSlot(pickerTarget.partyIndex, pickerTarget.slotIndex, player.id);
    setPickerTarget(null);
  }

  function handleOpenNotes() {
    if (raid?.notes_updated_at) {
      localStorage.setItem(notesSeenKey, raid.notes_updated_at);
    }
    setNotesUnseen(false);
    setNotesOpen(true);
  }

  async function handleSaveNotes(notes: string) {
    setSavingNotes(true);
    try {
      const { raid: updated } = await api.updateNotes(raidId, notes.trim());
      setRaid(updated);
      if (updated.notes_updated_at) {
        localStorage.setItem(notesSeenKey, updated.notes_updated_at);
      }
      setNotesUnseen(false);
      setNotesOpen(false);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleApplyPermaParties(target: RaidBoardKey, assignments: PermaPartyAssignment[]) {
    const result = await api.applyPermaParties(raidId, target, assignments);
    setRaid(result.raid);
    setActiveBoard(target);
    return result;
  }

  async function autoAssignRole(role: AutoAssignRole) {
    const label = AUTO_ASSIGN_LABELS[role];
    const { raid: updated, assigned, full, noneLeft } = await api.autoAssign(raidId, activeBoard, role);
    setRaid(updated);
    const parts = [`Assigned ${assigned} ${assigned === 1 ? label.one : label.many} on ${boardLabel(activeBoard)}.`];
    if (noneLeft.length) parts.push(`No free ${label.one} left for part${noneLeft.length === 1 ? "y" : "ies"} ${noneLeft.join(", ")}.`);
    if (full.length) parts.push(`Full, skipped: part${full.length === 1 ? "y" : "ies"} ${full.join(", ")}.`);
    return parts.join(" ");
  }

  async function autoAssignParties() {
    const { raid: updated, assigned, incomplete } = await api.autoAssignParties(raidId, activeBoard);
    setRaid(updated);
    const parts = [`Assigned ${assigned} player${assigned === 1 ? "" : "s"} on ${boardLabel(activeBoard)}.`];
    if (incomplete.length) {
      parts.push(`Still missing — ${incomplete.map((p) => `party ${p.party}: ${p.missing.join(", ")}`).join("; ")}.`);
    }
    return parts.join(" ");
  }

  async function handleAction(key: string) {
    setRunningAction(key);
    try {
      setAutoAssignNotice(key === "parties" ? await autoAssignParties() : await autoAssignRole(key as AutoAssignRole));
    } catch (err) {
      setAutoAssignNotice(err instanceof Error ? err.message : "Couldn't auto assign");
    } finally {
      setRunningAction(null);
    }
  }

  async function handleDeleteRaid() {
    if (!confirm("Delete this raid team? This cannot be undone.")) return;
    await api.deleteRaid(raidId);
    navigate("/raids");
  }

  function handleExportImage() {
    setExporting(true);
  }

  // html-to-image needs the source node genuinely painted on screen (off-screen/hidden
  // nodes capture blank), so the snapshot mounts inside a full-screen overlay for the
  // brief moment it takes to render + capture it.
  useEffect(() => {
    if (!exporting || !raid) return;
    let cancelled = false;
    (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled || !exportRef.current) {
        setExporting(false);
        return;
      }
      try {
        const { toPng } = await import("html-to-image");
        const dataUrl = await toPng(exportRef.current, {
          backgroundColor: "#0b0e14",
          pixelRatio: 2,
        });
        const link = document.createElement("a");
        const safeName = raid.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "raid-team";
        const boardSuffix =
          activeBoard === "main" ? "" : `-${boardLabel(activeBoard).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        link.download = `${safeName}${boardSuffix}.png`;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error(err);
        alert("Couldn't export the image. Please try again.");
      } finally {
        if (!cancelled) setExporting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporting]);

  const board = raid?.boards[activeBoard];
  if (loading || !raid || !board) {
    return <p className="text-base text-ink-dim">Loading raid…</p>;
  }

  const raidBoards = RAID_TYPE_BOARDS[raid.type];
  const totalAssigned = board.parties.flat().filter(Boolean).length;
  const totalSlots = board.parties.length * 5;
  const exportCount = Math.max(1, exportTo - exportFrom + 1);
  const exportCols = Math.min(4, exportCount);
  const exportSlice = board.parties.slice(exportFrom - 1, exportTo);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/raids")}
              className="mb-2 text-sm text-ink-dim hover:text-ink"
            >
              ← Back to raid teams
            </button>
            <input
              id="raid-name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-full max-w-lg rounded-lg border border-transparent bg-transparent px-1.5 text-3xl font-bold text-heading outline-none hover:border-border focus:border-gold focus:bg-panel-alt"
            />
            <p className="mt-1.5 px-1.5 text-base text-ink-dim">
              {totalAssigned}/{totalSlots} players assigned ·{" "}
              <span className={activeBoard === raidBoards[0].key ? "text-gold" : "text-ink-dim"}>
                {boardLabel(activeBoard)} roster
              </span>
            </p>
            {autoAssignNotice && <p className="mt-1 px-1.5 text-sm text-ink-dim">{autoAssignNotice}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
              {raidBoards.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setActiveBoard(b.key)}
                  className={[
                    "rounded-md px-4 py-1.5 text-sm font-semibold uppercase transition-colors",
                    activeBoard === b.key
                      ? "bg-gold text-bg"
                      : "text-ink-dim hover:bg-panel-alt hover:text-ink",
                  ].join(" ")}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border p-1">
              <button
                onClick={() => handlePartyCountChange(-1)}
                className="h-9 w-9 rounded-md text-lg text-ink-dim hover:bg-panel-alt hover:text-ink"
                title="Remove a party"
              >
                −
              </button>
              <span className="px-3 text-base text-ink">{board.parties.length} parties</span>
              <button
                onClick={() => handlePartyCountChange(1)}
                className="h-9 w-9 rounded-md text-lg text-ink-dim hover:bg-panel-alt hover:text-ink"
                title="Add a party"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border p-1">
              <span className="pl-2 text-sm text-ink-dim">Export parties</span>
              <input
                type="number"
                min={1}
                max={board.parties.length}
                value={exportFrom}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Math.max(1, Math.min(board.parties.length, Number.isFinite(n) ? n : 1));
                  setExportFrom(clamped);
                  setExportTo((prev) => Math.max(prev, clamped));
                }}
                className="w-14 rounded-md border border-transparent bg-panel-alt px-2 py-1 text-center text-sm text-ink outline-none focus:border-gold"
              />
              <span className="text-sm text-ink-dim">to</span>
              <input
                type="number"
                min={1}
                max={board.parties.length}
                value={exportTo}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Math.max(1, Math.min(board.parties.length, Number.isFinite(n) ? n : 1));
                  setExportTo(clamped);
                  setExportFrom((prev) => Math.min(prev, clamped));
                }}
                className="w-14 rounded-md border border-transparent bg-panel-alt px-2 py-1 text-center text-sm text-ink outline-none focus:border-gold"
              />
            </div>
            <button
              onClick={() => setActionsOpen(true)}
              className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-gold hover:text-gold"
            >
              Actions
            </button>
            <button
              onClick={() => setPermaOpen(true)}
              className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-gold hover:text-gold"
            >
              Perma parties
            </button>
            <button
              onClick={handleOpenNotes}
              className="relative rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-gold hover:text-gold"
            >
              Notes
              {notesUnseen && (
                <span
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bg bg-gold"
                  aria-label="Notes updated"
                  title="Notes updated"
                />
              )}
            </button>
            <button
              onClick={handleExportImage}
              disabled={exporting}
              className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "Exporting…" : "Export as image"}
            </button>
            <button
              onClick={handleDeleteRaid}
              className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-danger hover:text-danger"
            >
              Delete raid
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim">
            Classes deployed · {boardLabel(activeBoard)}
          </h2>
          <ClassCounter parties={board.parties} />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-dim">
              Available players ({pool.length})
            </h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
            >
              <option value="gear_score">Sort: Gear Score</option>
              <option value="level">Sort: Level</option>
              <option value="class">Sort: Job/Class</option>
              <option value="ign">Sort: Name</option>
            </select>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none focus:border-gold"
            >
              <option value="all">All jobs/classes</option>
              {classOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <PoolPanel players={pool} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {board.parties.map((members, partyIndex) => (
              <Party
                key={`${activeBoard}-${partyIndex}`}
                partyIndex={partyIndex}
                name={board.partyNames[partyIndex] ?? null}
                members={members}
                onRemove={(slotIndex) => setSlot(partyIndex, slotIndex, null)}
                onRename={(name) => handleRenameParty(partyIndex, name)}
                onOpenPicker={(slotIndex) => setPickerTarget({ partyIndex, slotIndex })}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>{activeDrag && <PlayerCard player={activeDrag} overlay />}</DragOverlay>

      {pickerTarget && (
        <PlayerPickerModal
          partyIndex={pickerTarget.partyIndex}
          slotIndex={pickerTarget.slotIndex}
          players={pool}
          onSelect={handlePickPlayer}
          onClose={() => setPickerTarget(null)}
        />
      )}

      {actionsOpen && (
        <ActionsModal
          boardLabel={boardLabel(activeBoard)}
          actions={RAID_ACTIONS}
          running={runningAction}
          notice={autoAssignNotice}
          onRun={handleAction}
          onClose={() => setActionsOpen(false)}
        />
      )}

      {permaOpen && (
        <PermaPartiesModal
          players={players}
          boards={raid.boards}
          boardOptions={raidBoards}
          defaultBoard={activeBoard}
          onApply={handleApplyPermaParties}
          onClose={() => {
            setPermaOpen(false);
            loadPermaMembers();
          }}
        />
      )}

      {notesOpen && (
        <NotesModal
          initialNotes={raid.notes ?? ""}
          saving={savingNotes}
          onSave={handleSaveNotes}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {/* Static snapshot captured for "Export as image", mounted only while exporting.
          html-to-image needs the source node genuinely painted on screen (an off-screen or
          hidden node captures blank), so this is a real full-screen overlay, not a trick. */}
      {exporting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center gap-4 overflow-auto bg-bg/98 p-8">
          <p className="text-sm text-ink-dim">Generating image…</p>
          <div ref={exportRef} className="rounded-2xl bg-bg p-2">
            <div className="mb-4 px-1">
              <h2 className="text-xl font-bold text-heading">
                {raid.name} <span className="text-ink-dim">— {boardLabel(activeBoard)}</span>
              </h2>
              <p className="text-sm text-ink-dim">
                {exportSlice.flat().filter(Boolean).length}/{exportCount * 5} players assigned
                {(exportFrom > 1 || exportTo < board.parties.length) &&
                  ` · Parties ${exportFrom}–${exportTo}`}
              </p>
              <div className="mt-3">
                <ClassCounter parties={exportSlice} />
              </div>
            </div>
            <div
              className="grid gap-5"
              style={{
                width: exportCols * 285 + Math.max(0, exportCols - 1) * 20,
                gridTemplateColumns: `repeat(${exportCols}, 1fr)`,
              }}
            >
              {exportSlice.map((members, i) => {
                const partyIndex = exportFrom - 1 + i;
                return (
                  <ExportParty
                    key={partyIndex}
                    partyIndex={partyIndex}
                    name={board.partyNames[partyIndex] ?? null}
                    members={members}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
