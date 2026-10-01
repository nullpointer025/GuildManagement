// Name matching shared by the Discord checker and the guild league importer:
// makes in-game names, Discord names and screenshot names comparable despite
// decorations, brackets, spacing, mixed writing systems and I/l swaps.

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
export function compactName(name) {
  return name.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

// True when a screenshot name is a roster name part (4+ characters) with at most
// two stray characters in front — OCR often reads a "メ" or "鬼" prefix as "X",
// "A" or "XA", so "XPulgas" is "メPulgas". Both arguments compactName()'d.
function endsWithPart(name, part) {
  return [...part].length >= 4 && name.endsWith(part) && [...name].length - [...part].length <= 2;
}

// True when two names of 6+ characters differ by one inserted, missing or changed
// character — one misread letter, e.g. "[OP]JARAYKOMONK" for "[OP]ARAYKOMONK".
// Both arguments compactName()'d.
function oneEditApart(a, b) {
  const x = [...a];
  const y = [...b];
  if (Math.min(x.length, y.length) < 6 || Math.abs(x.length - y.length) > 1 || a === b) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  const rest = (n, m) => x.slice(i + n).join("") === y.slice(i + m).join("");
  return rest(1, 1) || rest(1, 0) || rest(0, 1);
}

// Finds which roster player a name from a battle-record screenshot belongs to.
// Tries, in order of confidence: the same name, the same name ignoring spaces and
// symbols, then one name found as a whole word inside the other (or at the end of
// it after a misread prefix), then one misread letter. Players still in
// the guild win ties with ones who left; any other tie returns null so an officer
// picks by hand rather than the importer guessing.
export function createRosterMatcher(players) {
  const roster = players.map((p) => {
    const name = normalizeName(p.ign);
    return { id: p.id, active: p.active === 1, name, compact: compactName(name), variants: ignVariants(name) };
  });
  return (rawName) => {
    const name = normalizeName(rawName);
    if (!name) return null;
    const compact = compactName(name);
    const variants = ignVariants(name);
    const scored = roster.map((p) => {
      let score = 0;
      if (p.name === name) score = 3;
      else if (p.compact && p.compact === compact) score = 2;
      else if (
        p.variants.some((v) => nameContainsIgn(name, v) || endsWithPart(compact, compactName(v))) ||
        variants.some((v) => nameContainsIgn(p.name, v))
      ) {
        score = 1;
      } else if (oneEditApart(p.compact, compact)) {
        score = 0.5;
      }
      return { id: p.id, score: score === 0 ? 0 : score * 4 + (p.active ? 1 : 0) };
    });
    const best = Math.max(0, ...scored.map((s) => s.score));
    if (best === 0) return null;
    const top = scored.filter((s) => s.score === best);
    return top.length === 1 ? top[0].id : null;
  };
}
