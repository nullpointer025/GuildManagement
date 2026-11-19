import { create } from "zustand";
import { api } from "../api/client";
import type { AccessRole, Guild } from "../types";

interface AuthState {
  unlocked: boolean;
  checked: boolean;
  // The guild the entered invite code belongs to.
  guild: Guild | null;
  // Viewers (who entered the viewer code) can look but not change anything.
  role: AccessRole;
  init: () => Promise<void>;
  setUnlocked: (unlocked: boolean) => Promise<void>;
  setGuild: (guild: Guild) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  unlocked: false,
  checked: false,
  guild: null,
  role: "viewer",
  async init() {
    try {
      const { guild, role } = await api.me();
      set({ unlocked: true, checked: true, guild, role });
    } catch {
      set({ unlocked: false, checked: true, guild: null, role: "viewer" });
    }
  },
  async setUnlocked(unlocked) {
    // Load the guild details and role for the code that was just entered before
    // showing any page, so a viewer never sees officer controls flash up.
    if (unlocked) await get().init();
    else set({ unlocked, checked: true });
  },
  setGuild(guild) {
    set({ guild });
  },
  async logout() {
    await api.logout();
    set({ unlocked: false, guild: null, role: "viewer" });
  },
}));

// True when the signed-in code is the guild's officer invite code.
export function useIsOfficer() {
  return useAuthStore((s) => s.role === "officer");
}
