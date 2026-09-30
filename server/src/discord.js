// Reads the guild Discord server's member list through a private bot (token and
// server ID from env). Plain REST calls — no gateway connection or discord.js.

const API = "https://discord.com/api/v10";
// Discord rejects requests without a bot-style User-Agent (error 40333).
const USER_AGENT = "DiscordBot (https://guildmanager.site, 1.0)";

export class DiscordError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function discordConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

async function discordGet(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "User-Agent": USER_AGENT,
      },
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil((body.retry_after ?? 1) * 1000)));
      continue;
    }
    if (res.status === 401) throw new DiscordError("Discord rejected the bot token — check DISCORD_BOT_TOKEN");
    if (res.status === 403) {
      throw new DiscordError(
        "Discord denied access — make sure the bot is in the server and Server Members Intent is turned on"
      );
    }
    if (res.status === 404) throw new DiscordError("Discord server not found — check DISCORD_GUILD_ID");
    if (!res.ok) throw new DiscordError(`Discord request failed (${res.status})`);
    return res.json();
  }
  throw new DiscordError("Discord is rate limiting requests, try again in a minute");
}

// All non-bot members, paginated 1000 at a time (Discord's max per request).
export async function fetchGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const members = [];
  let after = "0";
  for (;;) {
    const page = await discordGet(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    members.push(...page.filter((m) => !m.user?.bot));
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return members;
}

// Makes an IGN and a Discord name comparable: Unicode-normalized, case-insensitive,
// and ignoring stray symbols around the name (e.g. a Discord nick of "`Eve").
export function normalizeName(name) {
  return (name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}\p{M}]+$/u, "");
}

// True when the IGN appears in a Discord name as a whole word — set apart by the
// name's start/end or any non-letter (space, "/", "|", "]", …). So "BLUEGEMSTONE"
// matches "BLUEGEMSTONE/ต่อ" and "Fern" matches "[OP]Fern", but "Eve" doesn't
// match "Steve". Both arguments must already be normalizeName()'d.
export function nameContainsIgn(name, ign) {
  if (!ign) return false;
  const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}\p{M}]/u.test(ch);
  for (let i = name.indexOf(ign); i !== -1; i = name.indexOf(ign, i + 1)) {
    const before = [...name.slice(0, i)].at(-1);
    const after = [...name.slice(i + ign.length)][0];
    if (!isWordChar(before) && !isWordChar(after)) return true;
  }
  return false;
}

// Every name a member could be matched by: server nickname first (what the guild
// sets to the IGN), then display name and username for members without one.
export function memberNames(member) {
  return [member.nick, member.user?.global_name, member.user?.username].filter(Boolean);
}
