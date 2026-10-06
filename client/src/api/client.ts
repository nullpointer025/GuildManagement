import type {
  ApplyPermaPartiesResult,
  AutoAssignPriestsResult,
  DiscordSyncSummary,
  ImportSummary,
  League,
  LeagueDetail,
  LeaguePreviewRow,
  LeagueResult,
  LeagueSaveRow,
  PermaParty,
  PermaPartyAssignment,
  Player,
  PlayerFlag,
  RaidBoardKey,
  RaidDetail,
  RaidSummary,
  RaidType,
  TrackerPlayer,
} from "../types";

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
  setPlayerFlag: (id: number, flag: PlayerFlag, value: boolean) =>
    request<{ player: Player }>(`/players/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ [flag]: value ? 1 : 0 }),
    }),
  syncDiscord: () => request<{ summary: DiscordSyncSummary }>("/players/discord-sync", { method: "POST" }),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ summary: ImportSummary }>("/players/import", { method: "POST", body: fd });
  },

  raids: () => request<{ raids: RaidSummary[] }>("/raids"),
  createRaid: (payload: { name: string; partyCount: number; type: RaidType }) =>
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
  applyPermaParties: (id: number, board: RaidBoardKey, assignments: PermaPartyAssignment[]) =>
    request<ApplyPermaPartiesResult>(`/raids/${id}/apply-perma-parties`, {
      method: "POST",
      body: JSON.stringify({ board, assignments }),
    }),
  autoAssignPriests: (id: number, board: RaidBoardKey) =>
    request<AutoAssignPriestsResult>(`/raids/${id}/auto-assign-priests`, {
      method: "POST",
      body: JSON.stringify({ board }),
    }),

  permaParties: () => request<{ permaParties: PermaParty[] }>("/perma-parties"),
  savePermaParty: (id: number | null, payload: { name: string; playerIds: number[] }) =>
    request<{ permaParties: PermaParty[] }>(id == null ? "/perma-parties" : `/perma-parties/${id}`, {
      method: id == null ? "POST" : "PUT",
      body: JSON.stringify(payload),
    }),
  deletePermaParty: (id: number) =>
    request<{ permaParties: PermaParty[] }>(`/perma-parties/${id}`, { method: "DELETE" }),

  leagues: () => request<{ leagues: League[] }>("/leagues"),
  league: (id: number) => request<{ league: LeagueDetail }>(`/leagues/${id}`),
  leagueTracker: () => request<{ leagueCount: number; players: TrackerPlayer[] }>("/leagues/tracker"),
  previewLeague: (csv: string) =>
    request<{ rows: LeaguePreviewRow[] }>("/leagues/preview", { method: "POST", body: JSON.stringify({ csv }) }),
  previewLeagueImages: (images: File[]) => {
    const fd = new FormData();
    for (const image of images) fd.append("images", image);
    return request<{ rows: LeaguePreviewRow[] }>("/leagues/preview-images", { method: "POST", body: fd });
  },
  saveLeague: (payload: {
    date: string;
    result: LeagueResult | null;
    participants: string;
    totalKills: string;
    towers: string;
    rows: LeagueSaveRow[];
  }) => request<{ id: number }>("/leagues", { method: "POST", body: JSON.stringify(payload) }),
  deleteLeague: (id: number) => request<{ ok: true }>(`/leagues/${id}`, { method: "DELETE" }),

  updateNotes: (id: number, notes: string) =>
    request<{ raid: RaidDetail }>(`/raids/${id}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),
};

export { ApiError };
