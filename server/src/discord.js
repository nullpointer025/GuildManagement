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
// "i" and "l" are treated as the same letter, since players swap a capital "I" for
// a lowercase "l" (they look identical in most fonts): "SkuIlCracker" = "SkullCracker".
export function normalizeName(name) {
  return (name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/l/g, "i")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}\p{M}]+$/u, "");
}

const SCRIPTS = ["Latin", "Han", "Hiragana", "Katakana", "Hangul", "Thai", "Cyrillic", "Greek", "Arabic"].map(
  (s) => [s, new RegExp(`\\p{Script=${s}}`, "u")]
);

function scriptOf(ch) {
  for (const [name, re] of SCRIPTS) if (re.test(ch)) return name;
  // Digits, "ー" and combining marks belong to no script, so they join whatever is next to them.
  return /[\p{Script=Common}\p{Script=Inherited}]/u.test(ch) ? null : "Other";
}

const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}\p{M}]/u.test(ch);

// Two adjacent characters belong to the same word unless one is a space/symbol or
// they're letters from different writing systems — so "メSkullCracker" reads as
// "メ" + "SkullCracker", while "Eve2" stays one word.
function sameWord(a, b) {
  if (!isWordChar(a) || !isWordChar(b)) return false;
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  return sa === null || sb === null || sa === sb;
}

// The IGN itself, plus each single-script part of 3+ characters when it mixes
// writing systems ("メSkullCracker" also tries "skullcracker"). Symbols inside a
// part are kept, so "Eve_Mage" is never shortened to "eve".
export function ignVariants(ign) {
  if (!ign) return [];
  const chars = [...ign];
  const parts = [];
  let start = 0;
  for (let i = 1; i < chars.length; i++) {
    if (isWordChar(chars[i - 1]) && isWordChar(chars[i]) && !sameWord(chars[i - 1], chars[i])) {
      parts.push(chars.slice(start, i).join(""));
      start = i;
    }
  }
  if (start === 0) return [ign];
  parts.push(chars.slice(start).join(""));
  const extra = parts.map(normalizeName).filter((p) => [...p].length >= 3);
  return [...new Set([ign, ...extra])];
}

// True when the IGN appears in a Discord name as a whole word — set apart by the
// name's start/end, any non-letter (space, "/", "|", "]", …) or a switch of writing
// system. So "BLUEGEMSTONE" matches "BLUEGEMSTONE/ต่อ", "Fern" matches "[OP]Fern"
// and "Dragon" matches "闇Dragon", but "Eve" doesn't match "Steve". Both arguments
// must already be normalizeName()'d.
export function nameContainsIgn(name, ign) {
  if (!ign) return false;
  const ignChars = [...ign];
  for (let i = name.indexOf(ign); i !== -1; i = name.indexOf(ign, i + 1)) {
    const before = [...name.slice(0, i)].at(-1);
    const after = [...name.slice(i + ign.length)][0];
    if (!sameWord(before, ignChars[0]) && !sameWord(ignChars.at(-1), after)) return true;
  }
  return false;
}

// A name with every space and symbol removed, e.g. "『EQNX』ULYSSS" and
// "[EQNX] ULYSSS" both become "eqnxuiysss". Only ever compared whole, never as a
// substring, so dropping the separators can't make "Eve" match "Steve".
function compactName(name) {
  return name.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

// Builds the check the sync runs per player: is this IGN one of these members?
// A player matches when their IGN (or a single-script part of it) appears as a
// whole word in any member's name, or when both names are equal once spaces and
// symbols are ignored (for tags written with different brackets or spacing).
export function createDiscordMatcher(members) {
  const names = [...new Set(members.flatMap((m) => memberNames(m).map(normalizeName)).filter(Boolean))];
  const compactNames = new Set(names.map(compactName).filter(Boolean));
  return (rawIgn) => {
    const ign = normalizeName(rawIgn);
    if (!ign) return false;
    if (compactNames.has(compactName(ign))) return true;
    const variants = ignVariants(ign);
    return names.some((name) => variants.some((v) => nameContainsIgn(name, v)));
  };
}

// Every name a member could be matched by: server nickname first (what the guild
// sets to the IGN), then display name and username for members without one.
export function memberNames(member) {
  return [member.nick, member.user?.global_name, member.user?.username].filter(Boolean);
}
