import { create } from "zustand";
import { api } from "../api/client";

interface AuthState {
  unlocked: boolean;
  checked: boolean;
  init: () => Promise<void>;
  setUnlocked: (unlocked: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  unlocked: false,
  checked: false,
  async init() {
    try {
      await api.me();
      set({ unlocked: true, checked: true });
    } catch {
      set({ unlocked: false, checked: true });
    }
  },
  setUnlocked(unlocked) {
    set({ unlocked, checked: true });
  },
  async logout() {
    await api.logout();
    set({ unlocked: false });
  },
}));
