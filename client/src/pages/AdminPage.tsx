import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { AdminGuild } from "../types";
import { AuthShell, Field, buttonClass, inputClass } from "../components/FormKit";

const smallButton =
  "rounded-lg border border-border px-3 py-1.5 text-sm text-ink-dim transition-colors hover:border-ink hover:text-ink disabled:opacity-60";
const cellInput =
  "w-full rounded-md border border-border bg-panel-alt px-2 py-1.5 text-sm text-ink outline-none focus:border-gold";

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

// A random code that is easy to read out loud (no 0/O/1/I).
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Site admin: every guild, its invite code and Discord server. Unlocked with ADMIN_CODE.
export function AdminPage() {
  const [checked, setChecked] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    api
      .adminMe()
      .then(() => setAdmin(true))
      .catch(() => setAdmin(false))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="flex h-screen items-center justify-center text-ink-dim">Loading…</div>;
  if (!admin) return <AdminGate onUnlocked={() => setAdmin(true)} />;
  return <GuildAdmin onLogout={() => setAdmin(false)} />;
}

function AdminGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.adminEnter(code);
      onUnlocked();
    } catch (err) {
      setError(errorText(err, "Couldn't enter, please try again"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Site admin" subtitle="Enter the admin code to manage guilds and their invite codes.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Admin code">
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required className={inputClass} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </AuthShell>
  );
}

function GuildAdmin({ onLogout }: { onLogout: () => void }) {
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminGuilds()
      .then(({ guilds }) => setGuilds(guilds))
      .catch((err) => setError(errorText(err, "Couldn't load guilds")))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await api.adminLogout();
    onLogout();
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-heading">
          <span aria-hidden>⚔</span> Guilds
        </h1>
        <div className="flex items-center gap-3">
          <Link to="/enter" className={smallButton}>
            Guild login
          </Link>
          <button onClick={handleLogout} className={smallButton}>
            Logout
          </button>
        </div>
      </div>

      <CreateGuildForm onCreated={setGuilds} />

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="text-ink-dim">Loading…</p>
      ) : guilds.length === 0 ? (
        <p className="text-ink-dim">No guilds yet. Create the first one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-dim">
              <tr>
                <th className="p-3">Guild</th>
                <th className="p-3">Invite code</th>
                <th className="p-3">Discord sync</th>
                <th className="p-3 text-right">Active players</th>
                <th className="p-3 text-right">Raids</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {guilds.map((g) => (
                <GuildRow key={g.id} guild={g} onChange={setGuilds} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-sm text-ink-dim">
        Changing a guild's invite code signs all of its officers out; they get back in with the new code. Deleting a
        guild deletes its roster, raids, perma parties and league history.
      </p>
    </div>
  );
}

function CreateGuildForm({ onCreated }: { onCreated: (guilds: AdminGuild[]) => void }) {
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState(randomCode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { guilds } = await api.adminCreateGuild({ name, inviteCode });
      onCreated(guilds);
      setName("");
      setInviteCode(randomCode());
    } catch (err) {
      setError(errorText(err, "Couldn't create the guild"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-border bg-panel p-5">
      <h2 className="mb-4 text-base font-semibold text-heading">New guild</h2>
      <div className="grid gap-4 md:grid-cols-[2fr_2fr_auto] md:items-end">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} className={inputClass} />
        </Field>
        <Field label="Invite code">
          <div className="flex gap-2">
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required minLength={6} className={inputClass} />
            <button type="button" onClick={() => setInviteCode(randomCode())} className={smallButton} title="Generate a new code">
              ↻
            </button>
          </div>
        </Field>
        <button type="submit" disabled={saving} className="rounded-lg bg-gold px-5 py-2.5 text-base font-semibold text-bg hover:bg-gold-bright disabled:opacity-60">
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </form>
  );
}

function GuildRow({ guild, onChange }: { guild: AdminGuild; onChange: (guilds: AdminGuild[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(guild.name);
  const [inviteCode, setInviteCode] = useState(guild.inviteCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setName(guild.name);
    setInviteCode(guild.inviteCode);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const { guilds } = await api.adminUpdateGuild(guild.id, { name, inviteCode });
      onChange(guilds);
      setEditing(false);
    } catch (err) {
      setError(errorText(err, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${guild.name}" and ALL of its data (roster, raids, leagues)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { guilds } = await api.adminDeleteGuild(guild.id);
      onChange(guilds);
    } catch (err) {
      setError(errorText(err, "Couldn't delete"));
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="p-3 font-medium text-ink">
          {editing ? <input value={name} onChange={(e) => setName(e.target.value)} className={cellInput} /> : guild.name}
        </td>
        <td className="p-3 font-mono text-ink">
          {editing ? (
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className={cellInput} />
          ) : (
            guild.inviteCode
          )}
        </td>
        <td className="p-3 font-mono text-ink-dim">
          {guild.discordGuildId ? `on · ${guild.discordGuildId}` : "off"}
        </td>
        <td className="p-3 text-right text-ink">{guild.activePlayers}</td>
        <td className="p-3 text-right text-ink">{guild.raids}</td>
        <td className="p-3">
          <div className="flex justify-end gap-2">
            {editing ? (
              <>
                <button onClick={handleSave} disabled={busy} className={smallButton}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)} disabled={busy} className={smallButton}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={startEdit} disabled={busy} className={smallButton}>
                  Edit
                </button>
                <button onClick={handleDelete} disabled={busy} className={`${smallButton} hover:border-danger hover:text-danger`}>
                  Delete
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} className="px-3 pb-3 text-sm text-danger">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}
