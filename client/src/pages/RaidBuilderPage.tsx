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
import type { Player, RaidDetail } from "../types";
import type { DragOrigin } from "../components/DraggablePlayer";
import { PoolPanel } from "../components/PoolPanel";
import { Party } from "../components/Party";
import { ExportParty } from "../components/ExportParty";
import { PlayerCard } from "../components/PlayerCard";

type SortKey = "gear_score" | "level" | "ign" | "class";

export function RaidBuilderPage() {
  const { id } = useParams();
  const raidId = Number(id);
  const navigate = useNavigate();

  const [raid, setRaid] = useState<RaidDetail | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("gear_score");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [activeDrag, setActiveDrag] = useState<Player | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState(1);
  const [exportTo, setExportTo] = useState(8);
  const exportRef = useRef<HTMLDivElement>(null);

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
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [raidId]);

  // Keep the export range in sync with the raid's actual party count, without
  // clobbering a smaller range the officer deliberately picked.
  useEffect(() => {
    if (!raid) return;
    setExportTo((prev) => Math.min(prev, raid.party_count) || raid.party_count);
    setExportFrom((prev) => Math.min(prev, raid.party_count) || 1);
  }, [raid?.party_count]);

  const classOptions = useMemo(() => {
    const classes = new Set(
      players.filter((p) => p.active === 1 && p.class).map((p) => p.class as string)
    );
    return Array.from(classes).sort((a, b) => a.localeCompare(b));
  }, [players]);

  const pool = useMemo(() => {
    if (!raid) return [];
    const assigned = new Set(raid.parties.flat().filter(Boolean).map((p) => (p as Player).id));
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
  }, [raid, players, search, sortKey, classFilter]);

  async function setSlot(partyIndex: number, slotIndex: number, playerId: number | null) {
    const { raid: updated } = await api.setSlot(raidId, { partyIndex, slotIndex, playerId });
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

    const occupant = raid.parties[partyIndex]?.[slotIndex] ?? null;
    await setSlot(partyIndex, slotIndex, activeData.player.id);

    if (occupant && activeData.from.type === "slot") {
      await setSlot(activeData.from.partyIndex, activeData.from.slotIndex, occupant.id);
    }
  }

  async function handlePartyCountChange(delta: number) {
    if (!raid) return;
    const next = raid.party_count + delta;
    if (next < 1 || next > 20) return;
    const { raid: updated } = await api.updateRaid(raidId, { partyCount: next });
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
    const { raid: updated } = await api.renameParty(raidId, partyIndex, name);
    setRaid(updated);
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
        link.download = `${safeName}.png`;
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

  if (loading || !raid) {
    return <p className="text-base text-ink-dim">Loading raid…</p>;
  }

  const totalAssigned = raid.parties.flat().filter(Boolean).length;
  const totalSlots = raid.party_count * 5;
  const exportCount = Math.max(1, exportTo - exportFrom + 1);
  const exportCols = Math.min(4, exportCount);
  const exportSlice = raid.parties.slice(exportFrom - 1, exportTo);

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
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-full max-w-lg rounded-lg border border-transparent bg-transparent px-1.5 text-3xl font-bold text-heading outline-none hover:border-border focus:border-gold focus:bg-panel-alt"
            />
            <p className="mt-1.5 px-1.5 text-base text-ink-dim">
              {totalAssigned}/{totalSlots} players assigned
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-border p-1">
              <button
                onClick={() => handlePartyCountChange(-1)}
                className="h-9 w-9 rounded-md text-lg text-ink-dim hover:bg-panel-alt hover:text-ink"
                title="Remove a party"
              >
                −
              </button>
              <span className="px-3 text-base text-ink">{raid.party_count} parties</span>
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
                max={raid.party_count}
                value={exportFrom}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Math.max(1, Math.min(raid.party_count, Number.isFinite(n) ? n : 1));
                  setExportFrom(clamped);
                  setExportTo((prev) => Math.max(prev, clamped));
                }}
                className="w-14 rounded-md border border-transparent bg-panel-alt px-2 py-1 text-center text-sm text-ink outline-none focus:border-gold"
              />
              <span className="text-sm text-ink-dim">to</span>
              <input
                type="number"
                min={1}
                max={raid.party_count}
                value={exportTo}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Math.max(1, Math.min(raid.party_count, Number.isFinite(n) ? n : 1));
                  setExportTo(clamped);
                  setExportFrom((prev) => Math.min(prev, clamped));
                }}
                className="w-14 rounded-md border border-transparent bg-panel-alt px-2 py-1 text-center text-sm text-ink outline-none focus:border-gold"
              />
            </div>
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

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3">
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
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <PoolPanel players={pool} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {raid.parties.map((members, partyIndex) => (
              <Party
                key={partyIndex}
                partyIndex={partyIndex}
                name={raid.partyNames[partyIndex] ?? null}
                members={members}
                onRemove={(slotIndex) => setSlot(partyIndex, slotIndex, null)}
                onRename={(name) => handleRenameParty(partyIndex, name)}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>{activeDrag && <PlayerCard player={activeDrag} overlay />}</DragOverlay>

      {/* Static snapshot captured for "Export as image", mounted only while exporting.
          html-to-image needs the source node genuinely painted on screen (an off-screen or
          hidden node captures blank), so this is a real full-screen overlay, not a trick. */}
      {exporting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center gap-4 overflow-auto bg-bg/98 p-8">
          <p className="text-sm text-ink-dim">Generating image…</p>
          <div ref={exportRef} className="rounded-2xl bg-bg p-2">
            <div className="mb-4 px-1">
              <h2 className="text-xl font-bold text-heading">{raid.name}</h2>
              <p className="text-sm text-ink-dim">
                {exportSlice.flat().filter(Boolean).length}/{exportCount * 5} players assigned
                {(exportFrom > 1 || exportTo < raid.party_count) &&
                  ` · Parties ${exportFrom}–${exportTo}`}
              </p>
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
                    name={raid.partyNames[partyIndex] ?? null}
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
