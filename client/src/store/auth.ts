import { create } from "zustand";
import { api } from "../api/client";
import type { Guild } from "../types";

interface AuthState {
  unlocked: boolean;
  checked: boolean;
  // The guild the entered invite code belongs to.
  guild: Guild | null;
  init: () => Promise<void>;
  setUnlocked: (unlocked: boolean) => void;
  setGuild: (guild: Guild) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  unlocked: false,
  checked: false,
  guild: null,
  async init() {
    try {
      const { guild } = await api.me();
      set({ unlocked: true, checked: true, guild });
    } catch {
      set({ unlocked: false, checked: true, guild: null });
    }
  },
  setUnlocked(unlocked) {
    set({ unlocked, checked: true });
    // Load the guild details for the code that was just entered.
    if (unlocked) get().init();
  },
  setGuild(guild) {
    set({ guild });
  },
  async logout() {
    await api.logout();
    set({ unlocked: false, guild: null });
  },
}));
