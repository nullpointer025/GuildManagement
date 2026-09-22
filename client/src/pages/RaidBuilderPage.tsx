import { useEffect, useMemo, useState } from "react";
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

  async function handleDeleteRaid() {
    if (!confirm("Delete this raid team? This cannot be undone.")) return;
    await api.deleteRaid(raidId);
    navigate("/raids");
  }

  if (loading || !raid) {
    return <p className="text-base text-ink-dim">Loading raid…</p>;
  }

  const totalAssigned = raid.parties.flat().filter(Boolean).length;
  const totalSlots = raid.party_count * 5;

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
                members={members}
                onRemove={(slotIndex) => setSlot(partyIndex, slotIndex, null)}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>{activeDrag && <PlayerCard player={activeDrag} overlay />}</DragOverlay>
    </DndContext>
  );
}
