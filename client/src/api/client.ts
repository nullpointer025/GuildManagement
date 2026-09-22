import type { ImportSummary, Player, RaidDetail, RaidSummary, User } from "../types";

const BASE = "/api";

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: isFormData ? undefined : { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (payload: { username: string; password: string; inviteCode: string }) =>
    request<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: { username: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),

  players: () => request<{ players: Player[] }>("/players"),
  setPlayerActive: (id: number, active: boolean) =>
    request<{ player: Player }>(`/players/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: active ? 1 : 0 }),
    }),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ summary: ImportSummary }>("/players/import", { method: "POST", body: fd });
  },

  raids: () => request<{ raids: RaidSummary[] }>("/raids"),
  createRaid: (payload: { name: string; partyCount: number }) =>
    request<{ raid: RaidDetail }>("/raids", { method: "POST", body: JSON.stringify(payload) }),
  getRaid: (id: number) => request<{ raid: RaidDetail }>(`/raids/${id}`),
  updateRaid: (id: number, payload: { name?: string; partyCount?: number }) =>
    request<{ raid: RaidDetail }>(`/raids/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteRaid: (id: number) => request<{ ok: true }>(`/raids/${id}`, { method: "DELETE" }),
  setSlot: (id: number, payload: { partyIndex: number; slotIndex: number; playerId: number | null }) =>
    request<{ raid: RaidDetail }>(`/raids/${id}/slots`, { method: "PUT", body: JSON.stringify(payload) }),
};

export { ApiError };
