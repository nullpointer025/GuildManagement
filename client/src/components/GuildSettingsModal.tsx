import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
import { Field, inputClass } from "./FormKit";

export function GuildSettingsModal({ onClose }: { onClose: () => void }) {
  const guild = useAuthStore((s) => s.guild);
  const setGuild = useAuthStore((s) => s.setGuild);
  const [syncEnabled, setSyncEnabled] = useState(guild?.discordSyncEnabled ?? false);
  const [discordGuildId, setDiscordGuildId] = useState(guild?.discordGuildId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSave() {
    if (syncEnabled && !discordGuildId.trim()) {
      setError("Enter your Discord server ID to turn on Discord sync");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { guild } = await api.updateGuildSettings({ discordSyncEnabled: syncEnabled, discordGuildId });
      setGuild(guild);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col rounded-2xl border border-border bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-base font-semibold text-heading">Guild settings — {guild?.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-ink-dim hover:border-danger hover:text-danger"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => {
                setSyncEnabled(e.target.checked);
                setError(null);
              }}
              className="mt-1 h-4 w-4 accent-[#d9a441]"
            />
            <span>
              <span className="block text-base text-ink">Sync with Discord</span>
              <span className="block text-sm text-ink-dim">
                Ticks "In Discord" for every roster member found in your Discord server, and re-checks after each CSV
                import. When off, you tick "In Discord" by hand.
              </span>
            </span>
          </label>

          {syncEnabled && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel-alt/50 p-4">
              <Field label="Discord server ID">
                <input
                  value={discordGuildId}
                  onChange={(e) => setDiscordGuildId(e.target.value)}
                  placeholder="e.g. 123456789012345678"
                  inputMode="numeric"
                  autoFocus
                  required
                  className={inputClass}
                />
              </Field>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-dim">
                <li>
                  In Discord, open <span className="text-ink">User Settings → Advanced</span> and turn on{" "}
                  <span className="text-ink">Developer Mode</span>.
                </li>
                <li>
                  Right-click your server icon and choose <span className="text-ink">Copy Server ID</span>, then paste
                  it above.
                </li>
                <li>Ask the site admin for the bot's invite link and add the bot to your server.</li>
              </ol>
              {guild && !guild.discordBotAvailable && (
                <p className="text-sm text-danger">
                  No Discord bot is set up on this site yet, so syncing won't work until the admin adds one.
                </p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim hover:border-ink hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gold px-4 py-2 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
