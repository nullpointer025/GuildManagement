import { create } from "zustand";
import { api } from "../api/client";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  checked: boolean;
  init: () => Promise<void>;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  checked: false,
  async init() {
    try {
      const { user } = await api.me();
      set({ user, checked: true });
    } catch {
      set({ user: null, checked: true });
    }
  },
  setUser(user) {
    set({ user, checked: true });
  },
  async logout() {
    await api.logout();
    set({ user: null });
  },
}));
