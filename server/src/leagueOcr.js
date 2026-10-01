import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tesseract language packs for player names, e.g. "eng+jpn+tha". Each one lets
// names in that script be read (メNull, 死神Shinigami, ราชา). Packs are downloaded
// once on first use and cached in server/data/ocr. Stats are always read as digits.
const NAME_LANGS = (process.env.OCR_LANGS || "eng+jpn+tha").split("+").map((l) => l.trim()).filter(Boolean);
const CACHE_PATH = path.join(__dirname, "..", "data", "ocr");

// Battle-record text is pure white; the background (sky, clouds, row tint) never
// is. Keeping only pixels whose darkest RGB channel is at least this bright drops
// the background however light or colorful it is.
const WHITE_THRESHOLD = 215;
// Stat columns, left to right.
const STAT_KEYS = ["kills", "assists", "player_damage", "building_damage"];
// A stat as OCR reads it: "140", "12.3M", "790.0M", "5K".
const STAT_TOKEN = /^\d[\d,.]*[KMB]?$/i;

let workersPromise = null;
let queue = Promise.resolve();

async function makeWorker(langs, params) {
  const worker = await createWorker(langs, undefined, { cachePath: CACHE_PATH });
  await worker.setParameters({ user_defined_dpi: "300", ...params });
  return worker;
}

function getWorkers() {
  if (!workersPromise) {
    workersPromise = (async () => {
      fs.mkdirSync(CACHE_PATH, { recursive: true });
      const [page, stat, name] = await Promise.all([
        // Finds the rows and roughly where each word sits.
        makeWorker(["eng"], { tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" }),
        // Re-reads one stat cell at a time, digits only.
        makeWorker(["eng"], { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: "0123456789.KMB" }),
        // Re-reads one name cell at a time, in every name language.
        makeWorker(NAME_LANGS, { tessedit_pageseg_mode: PSM.SINGLE_LINE }),
      ]);
      return { page, stat, name };
    })().catch((err) => {
      workersPromise = null;
      throw err;
    });
  }
  return workersPromise;
}

// Turns a screenshot into black text on white, scaled up so small digits are
// ~40px tall, which is what Tesseract reads best.
async function prepare(buffer) {
  const { data, info } = await sharp(buffer).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width < 1600 ? 2 : 1;
  const darkest = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < darkest.length; i++) {
    darkest[i] = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  }
  const bw = await sharp(darkest, { raw: { width: info.width, height: info.height, channels: 1 } })
    .resize({ width: info.width * scale, kernel: "lanczos3" })
    .threshold(WHITE_THRESHOLD)
    .negate({ alpha: false })
    .png()
    .toBuffer();
  return { png: bw, width: info.width * scale, height: info.height * scale };
}

// Fixes letters OCR commonly reads instead of digits, only inside a stat.
function cleanStat(text) {
  let t = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|\]]/g, "1")
    .replace(/[^\dKMB.,]/gi, "")
    .toUpperCase()
    .replace(/[.,]+$/, "");
  // "12,3M" is "12.3M" read with a comma.
  t = t.replace(/^(\d+),(\d)([KMB])$/, "$1.$2$3");
  // The game shows K/M/B values with one decimal ("790.0M"), so "251M" is "25.1M"
  // with the dot missed.
  t = t.replace(/^(\d+)(\d)([KMB])$/, "$1.$2$3");
  return t;
}

const isStat = (text) => STAT_TOKEN.test(text);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const centerOf = (w) => (w.x0 + w.x1) / 2;

// Every text line on the page as { words: [{ text, x0, x1 }], y0, y1 }, with
// x positions as fractions of the image width.
async function readLines(worker, image) {
  const { data } = await worker.recognize(image.png, {}, { blocks: true, text: false });
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  return lines
    .map((l) => ({
      y0: l.bbox.y0,
      y1: l.bbox.y1,
      words: l.words
        .filter((w) => w.text.trim())
        .map((w) => ({ text: w.text.trim(), x0: w.bbox.x0 / image.width, x1: w.bbox.x1 / image.width })),
    }))
    .filter((l) => l.words.length > 0);
}

// The column header ("Player  Kill  Assist  Player Damage  Building Damage").
function findHeader(lines) {
  return lines.find((l) => /kil|assist|damag/i.test(l.words.map((w) => w.text).join(" ")));
}

// Where the name column starts and the four stat columns' centers, as fractions
// of the width, measured from this page's cleanly read rows.
function measureColumns(lines, header) {
  const centers = STAT_KEYS.map(() => []);
  for (const line of lines) {
    if (line === header) continue;
    const tail = line.words.slice(-4);
    if (line.words.length >= 5 && tail.every((w) => isStat(cleanStat(w.text)))) {
      tail.forEach((w, i) => centers[i].push(centerOf(w)));
    }
  }
  const nameWord = header?.words.find((w) => /[a-z]{3,}/i.test(w.text));
  return {
    nameLeft: nameWord ? nameWord.x0 : null,
    stats: centers.map(median),
    samples: centers[0].length,
  };
}

// Splits one line's words into the icon, the name and the four stat cells.
function splitLine(line, cols) {
  const [kill, assist] = cols.stats;
  const nameEnd = kill - (assist - kill) / 2;
  const iconEnd = cols.nameLeft != null ? cols.nameLeft - 0.01 : -1;
  const name = [];
  const stats = STAT_KEYS.map(() => []);
  for (const w of line.words) {
    const c = centerOf(w);
    if (c < iconEnd) continue;
    if (c < nameEnd) {
      name.push(w);
      continue;
    }
    let best = 0;
    cols.stats.forEach((s, i) => {
      if (Math.abs(c - s) < Math.abs(c - cols.stats[best])) best = i;
    });
    stats[best].push(w);
  }
  return { name, stats };
}

async function readCell(worker, image, x0, x1, y0, y1) {
  const left = Math.max(0, Math.floor(x0 * image.width));
  const right = Math.min(image.width, Math.ceil(x1 * image.width));
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(image.height, Math.ceil(y1));
  if (right - left < 4 || bottom - top < 4) return "";
  const crop = await sharp(image.png)
    .extract({ left, top, width: right - left, height: bottom - top })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: "#ffffff" })
    .png()
    .toBuffer();
  const { data } = await worker.recognize(crop);
  return data.text.trim();
}

// Scripts written without spaces, where OCR puts one between every character
// ("ร า ชา" for "ราชา").
const NO_SPACE_SCRIPT = /[\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}ー]/u;

// Name as shown, minus anything OCR made of the class icon or row edges.
function cleanName(text) {
  const chars = [...String(text ?? "").replace(/\s+/g, " ")];
  const joined = chars
    .filter((ch, i) => ch !== " " || !(NO_SPACE_SCRIPT.test(chars[i - 1] ?? "") || NO_SPACE_SCRIPT.test(chars[i + 1] ?? "")))
    .join("");
  return joined
    .replace(/^[^\p{L}\p{N}[(【『「]+/u, "")
    .replace(/[^\p{L}\p{N}\p{M})\]】』」_\-~.]+$/u, "")
    .trim();
}

// Reads one page into rows, re-reading every cell on its own: stats with a
// digits-only reader (so "11" isn't read as "1" or "n"), names in every name
// language. A row is never dropped for an unreadable value — the raw text is
// kept so the officer sees it flagged in the review table.
async function readPage(workers, image, lines, cols) {
  const header = findHeader(lines);
  const headerBottom = header ? header.y1 : -1;
  const [kill, assist] = cols.stats;
  const nameEnd = kill - (assist - kill) / 2;
  const bounds = cols.stats.map((c, i) => [
    i === 0 ? nameEnd : (cols.stats[i - 1] + c) / 2,
    i === cols.stats.length - 1 ? Math.min(1, c + (c - cols.stats[i - 1]) / 2) : (c + cols.stats[i + 1]) / 2,
  ]);

  const rows = [];
  for (const line of lines) {
    if (line === header || line.y0 < headerBottom) continue;
    const { name, stats } = splitLine(line, cols);
    const filled = stats.filter((s) => s.length > 0).length;
    if (filled < 2 && !(name.length > 0 && filled >= 1)) continue;

    const pad = (line.y1 - line.y0) * 0.35;
    const y0 = line.y0 - pad;
    const y1 = line.y1 + pad;
    const row = {};
    for (let i = 0; i < STAT_KEYS.length; i++) {
      const fromPage = cleanStat(stats[i].map((w) => w.text).join(""));
      const fromCell = cleanStat(await readCell(workers.stat, image, bounds[i][0], bounds[i][1], y0, y1));
      row[STAT_KEYS[i]] = isStat(fromCell) ? fromCell : isStat(fromPage) ? fromPage : stats[i].map((w) => w.text).join(" ");
    }
    const nameLeft = cols.nameLeft != null ? cols.nameLeft - 0.005 : name[0]?.x0 ?? 0;
    const fromCell = cleanName(await readCell(workers.name, image, nameLeft, nameEnd - 0.005, y0, y1));
    row.ign = fromCell || cleanName(name.map((w) => w.text).join(" "));
    rows.push(row);
  }
  return rows;
}

// Reads the battle-record screenshots of one league, in upload order, into raw rows
// for parseLeagueRows. Jobs run one at a time on shared workers.
export function readBattleRecordImages(buffers) {
  const job = queue.then(async () => {
    const workers = await getWorkers();
    const pages = [];
    for (const buffer of buffers) {
      const image = await prepare(buffer);
      const lines = await readLines(workers.page, image);
      pages.push({ image, lines, cols: measureColumns(lines, findHeader(lines)) });
    }

    // Every screenshot of a league has the same layout, so a page with too few
    // clean rows borrows the column positions measured on the others.
    const all = pages.filter((p) => p.cols.samples > 0);
    const shared = {
      nameLeft: median(pages.map((p) => p.cols.nameLeft).filter((v) => v != null)),
      stats: STAT_KEYS.map((_, i) => median(all.map((p) => p.cols.stats[i]))),
    };
    if (shared.stats.some((s) => s == null)) return [];

    const rows = [];
    let unreadable = 0;
    for (const page of pages) {
      const cols = {
        nameLeft: page.cols.nameLeft ?? shared.nameLeft,
        stats: page.cols.samples >= 2 ? page.cols.stats : shared.stats,
      };
      for (const row of await readPage(workers, page.image, page.lines, cols)) {
        if (!row.ign) row.ign = `(unreadable name ${++unreadable})`;
        rows.push(row);
      }
    }
    return rows;
  });
  queue = job.catch(() => {});
  return job;
}
