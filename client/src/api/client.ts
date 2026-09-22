import type { ImportSummary, Player, RaidBoardKey, RaidDetail, RaidSummary } from "../types";

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
  enter: (code: string) =>
    request<{ ok: true }>("/auth/enter", { method: "POST", body: JSON.stringify({ code }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ unlocked: true }>("/auth/me"),

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
  updateRaid: (id: number, payload: { name: string }) =>
    request<{ raid: RaidDetail }>(`/raids/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updatePartyCount: (id: number, board: RaidBoardKey, partyCount: number) =>
    request<{ raid: RaidDetail }>(`/raids/${id}/party-count`, {
      method: "PATCH",
      body: JSON.stringify({ board, partyCount }),
    }),
  deleteRaid: (id: number) => request<{ ok: true }>(`/raids/${id}`, { method: "DELETE" }),
  setSlot: (
    id: number,
    payload: { board: RaidBoardKey; partyIndex: number; slotIndex: number; playerId: number | null }
  ) => request<{ raid: RaidDetail }>(`/raids/${id}/slots`, { method: "PUT", body: JSON.stringify(payload) }),
  renameParty: (id: number, partyIndex: number, board: RaidBoardKey, name: string) =>
    request<{ raid: RaidDetail }>(`/raids/${id}/parties/${partyIndex}`, {
      method: "PATCH",
      body: JSON.stringify({ board, name }),
    }),
  updateNotes: (id: number, notes: string) =>
    request<{ raid: RaidDetail }>(`/raids/${id}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),
};

export { ApiError };
