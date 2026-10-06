import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { RaidSummary, RaidType } from "../types";
import { buttonClass, inputClass } from "../components/FormKit";
import { RAID_TYPE_BOARDS, RAID_TYPE_LABELS } from "../lib/raidTypes";

export function RaidsListPage() {
  const [raids, setRaids] = useState<RaidSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [partyCount, setPartyCount] = useState(8);
  // No default: officers must say which content the raid is for.
  const [type, setType] = useState<RaidType | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const { raids } = await api.raids();
      setRaids(raids);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!type) {
      setError("Choose whether this raid is for Guild League or Polarity Zone");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { raid } = await api.createRaid({ name: name.trim(), partyCount, type });
      navigate(`/raids/${raid.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create raid");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this raid team? This cannot be undone.")) return;
    await api.deleteRaid(id);
    setRaids((r) => r.filter((raid) => raid.id !== id));
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-heading">Raid Teams</h1>
        <p className="mt-1.5 text-base text-ink-dim">
          Build and save drag-and-drop party compositions for your raids.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-panel p-6"
      >
        <div className="flex-1 min-w-56">
          <label className="mb-2 block text-sm font-medium uppercase tracking-wide text-ink-dim">
            New raid name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Saturday WoE"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium uppercase tracking-wide text-ink-dim">
            Raid for
          </label>
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            {(Object.keys(RAID_TYPE_LABELS) as RaidType[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setType(key);
                  setError(null);
                }}
                className={[
                  "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors",
                  type === key ? "bg-gold text-bg" : "text-ink-dim hover:bg-panel-alt hover:text-ink",
                ].join(" ")}
              >
                {RAID_TYPE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        {type === "polarity" ? (
          <div>
            <label className="mb-2 block text-sm font-medium uppercase tracking-wide text-ink-dim">
              Parties
            </label>
            <p className="py-2.5 text-sm text-ink">
              {RAID_TYPE_BOARDS.polarity.map((b) => `${b.label}: ${b.presetParties}`).join(" · ")}
            </p>
          </div>
        ) : (
          <div>
            <label className="mb-2 block text-sm font-medium uppercase tracking-wide text-ink-dim">
              Parties per tab ({partyCount * 5} players)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={partyCount}
              onChange={(e) => setPartyCount(Number(e.target.value))}
              className={`${inputClass} w-32`}
            />
          </div>
        )}
        <button type="submit" disabled={creating} className={`${buttonClass} w-auto px-8`}>
          {creating ? "Creating…" : "Create raid"}
        </button>
      </form>
      {error && <p className="text-base text-danger">{error}</p>}

      {loading && <p className="text-base text-ink-dim">Loading raids…</p>}

      {!loading && raids.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-base text-ink-dim">
          No raid teams yet. Create one above to start assigning players.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {raids.map((raid) => (
          <div
            key={raid.id}
            className="group relative rounded-2xl border border-border bg-panel p-5 transition-colors hover:border-gold/50"
          >
            <button
              onClick={() => navigate(`/raids/${raid.id}`)}
              className="block w-full text-left"
            >
              <h3 className="truncate pr-6 text-lg font-semibold text-heading">{raid.name}</h3>
              <p className="mt-1 text-sm font-medium text-gold">{RAID_TYPE_LABELS[raid.type]}</p>
              <p className="mt-1.5 text-sm text-ink-dim">
                {RAID_TYPE_BOARDS[raid.type]
                  .map((b) => `${b.label}: ${raid.partyCounts[b.key] ?? 0} parties`)
                  .join(" · ")}
              </p>
              <p className="mt-4 text-sm text-ink-dim">
                Updated {new Date(raid.updated_at).toLocaleString()}
              </p>
            </button>
            <button
              onClick={() => handleDelete(raid.id)}
              className="absolute right-4 top-4 hidden h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger group-hover:flex"
              title="Delete raid"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
