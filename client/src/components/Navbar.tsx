import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore, useIsOfficer } from "../store/auth";
import { GuildSettingsModal } from "./GuildSettingsModal";

export function Navbar() {
  const logout = useAuthStore((s) => s.logout);
  const guild = useAuthStore((s) => s.guild);
  const isOfficer = useIsOfficer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/enter");
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "rounded-lg px-4 py-2 text-base font-medium transition-colors",
      isActive ? "bg-gold/15 text-gold" : "text-ink-dim hover:bg-panel-alt hover:text-ink",
    ].join(" ");

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold tracking-wide text-heading">
            <span aria-hidden>⚔</span> <span className="text-gold">Guild</span>Manager
          </span>
          <nav className="flex items-center gap-1">
            <NavLink to="/roster" className={linkClass}>
              Roster
            </NavLink>
            <NavLink to="/raids" className={linkClass}>
              Raid Teams
            </NavLink>
            <NavLink to="/league" className={linkClass}>
              Guild League
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {guild && !isOfficer && (
            <span className="flex items-center gap-2 px-3 py-2 text-base font-medium text-gold">
              {guild.name}
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs uppercase tracking-wide text-ink-dim">
                View only
              </span>
            </span>
          )}
          {guild && isOfficer && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="Guild settings"
              className="rounded-lg px-3 py-2 text-base font-medium text-gold transition-colors hover:bg-panel-alt"
            >
              {guild.name} <span aria-hidden>⚙</span>
            </button>
          )}
          <button
            onClick={handleLogout}
            className="rounded-lg border border-border px-4 py-2 text-base text-ink-dim transition-colors hover:border-danger hover:text-danger"
          >
            Logout
          </button>
        </div>
      </div>
      {settingsOpen && <GuildSettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
