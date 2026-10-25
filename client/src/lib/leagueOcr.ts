import { createWorker, PSM, type Worker } from "tesseract.js";

// Reads Guild League battle-record screenshots in the browser, so screenshots never
// have to be uploaded. The result is raw text rows the server parses and matches.

export interface RawLeagueRow {
  ign: string;
  kills: string;
  assists: string;
  player_damage: string;
  building_damage: string;
}

// Tesseract language packs for player names, e.g. "eng+jpn+tha". Each one lets
// names in that script be read (メNull, 死神Shinigami, ราชา). Packs download once
// per browser and are cached there. Stats are always read as digits.
const NAME_LANGS = (import.meta.env.VITE_OCR_LANGS || "eng+jpn+tha")
  .split("+")
  .map((l: string) => l.trim())
  .filter(Boolean);

// Battle-record text is pure white; the background (sky, clouds, row tint) never
// is. Keeping only pixels whose darkest RGB channel is at least this bright drops
// the background however light or colorful it is.
const WHITE_THRESHOLD = 215;
// Stat columns, left to right.
const STAT_KEYS = ["kills", "assists", "player_damage", "building_damage"] as const;
// A stat as OCR reads it: "140", "12.3M", "790.0M", "5K".
const STAT_TOKEN = /^\d[\d,.]*[KMB]?$/i;

interface Workers {
  page: Worker;
  stat: Worker;
  name: Worker;
}

interface PreparedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

interface Word {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  words: Word[];
  y0: number;
  y1: number;
}

interface Columns {
  nameLeft: number | null;
  stats: (number | null)[];
  samples: number;
}

let workersPromise: Promise<Workers> | null = null;

async function makeWorker(langs: string[], params: Record<string, string>) {
  const worker = await createWorker(langs);
  await worker.setParameters({ user_defined_dpi: "300", ...params });
  return worker;
}

function getWorkers() {
  if (!workersPromise) {
    workersPromise = (async () => {
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

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  return { canvas, ctx };
}

// Turns a screenshot into black text on white, scaled up so small digits are
// ~40px tall, which is what Tesseract reads best.
async function prepare(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = bitmap;
  const source = makeCanvas(width, height);
  source.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Each pixel becomes its darkest channel, so only pure white stays bright.
  const pixels = source.ctx.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const darkest = Math.min(d[i], d[i + 1], d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = darkest;
    d[i + 3] = 255;
  }
  source.ctx.putImageData(pixels, 0, 0);

  const scale = width < 1600 ? 2 : 1;
  const out = makeCanvas(width * scale, height * scale);
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = "high";
  out.ctx.drawImage(source.canvas, 0, 0, width * scale, height * scale);

  // Threshold, then invert: white text turns black, everything else white.
  const scaled = out.ctx.getImageData(0, 0, out.canvas.width, out.canvas.height);
  const s = scaled.data;
  for (let i = 0; i < s.length; i += 4) {
    const v = s[i] >= WHITE_THRESHOLD ? 0 : 255;
    s[i] = s[i + 1] = s[i + 2] = v;
    s[i + 3] = 255;
  }
  out.ctx.putImageData(scaled, 0, 0);
  return { canvas: out.canvas, width: out.canvas.width, height: out.canvas.height };
}

// Fixes letters OCR commonly reads instead of digits, only inside a stat.
function cleanStat(text: string | null | undefined) {
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

const isStat = (text: string) => STAT_TOKEN.test(text);
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const centerOf = (w: Word) => (w.x0 + w.x1) / 2;

// Every text line on the page as { words: [{ text, x0, x1 }], y0, y1 }, with
// x positions as fractions of the image width.
async function readLines(worker: Worker, image: PreparedImage): Promise<Line[]> {
  const { data } = await worker.recognize(image.canvas, {}, { blocks: true, text: false });
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
function findHeader(lines: Line[]) {
  return lines.find((l) => /kil|assist|damag/i.test(l.words.map((w) => w.text).join(" ")));
}

// Where the name column starts and the four stat columns' centers, as fractions
// of the width, measured from this page's cleanly read rows.
function measureColumns(lines: Line[], header: Line | undefined): Columns {
  const centers: number[][] = STAT_KEYS.map(() => []);
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
function splitLine(line: Line, nameLeft: number | null, stats: number[]) {
  const [kill, assist] = stats;
  const nameEnd = kill - (assist - kill) / 2;
  const iconEnd = nameLeft != null ? nameLeft - 0.01 : -1;
  const name: Word[] = [];
  const cells: Word[][] = STAT_KEYS.map(() => []);
  for (const w of line.words) {
    const c = centerOf(w);
    if (c < iconEnd) continue;
    if (c < nameEnd) {
      name.push(w);
      continue;
    }
    let best = 0;
    stats.forEach((s, i) => {
      if (Math.abs(c - s) < Math.abs(c - stats[best])) best = i;
    });
    cells[best].push(w);
  }
  return { name, cells };
}

async function readCell(worker: Worker, image: PreparedImage, x0: number, x1: number, y0: number, y1: number) {
  const left = Math.max(0, Math.floor(x0 * image.width));
  const right = Math.min(image.width, Math.ceil(x1 * image.width));
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(image.height, Math.ceil(y1));
  if (right - left < 4 || bottom - top < 4) return "";
  const pad = 10;
  const { canvas, ctx } = makeCanvas(right - left + pad * 2, bottom - top + pad * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image.canvas, left, top, right - left, bottom - top, pad, pad, right - left, bottom - top);
  const { data } = await worker.recognize(canvas);
  return data.text.trim();
}

// Scripts written without spaces, where OCR puts one between every character
// ("ร า ชา" for "ราชา").
const NO_SPACE_SCRIPT = /[\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}ー]/u;

// Name as shown, minus anything OCR made of the class icon or row edges.
function cleanName(text: string | null | undefined) {
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
async function readPage(workers: Workers, image: PreparedImage, lines: Line[], nameLeft: number | null, stats: number[]) {
  const header = findHeader(lines);
  const headerBottom = header ? header.y1 : -1;
  const [kill, assist] = stats;
  const nameEnd = kill - (assist - kill) / 2;
  const bounds = stats.map((c, i) => [
    i === 0 ? nameEnd : (stats[i - 1] + c) / 2,
    i === stats.length - 1 ? Math.min(1, c + (c - stats[i - 1]) / 2) : (c + stats[i + 1]) / 2,
  ]);

  const rows: RawLeagueRow[] = [];
  for (const line of lines) {
    if (line === header || line.y0 < headerBottom) continue;
    const { name, cells } = splitLine(line, nameLeft, stats);
    const filled = cells.filter((s) => s.length > 0).length;
    if (filled < 2 && !(name.length > 0 && filled >= 1)) continue;

    const pad = (line.y1 - line.y0) * 0.35;
    const y0 = line.y0 - pad;
    const y1 = line.y1 + pad;
    const row = { ign: "" } as RawLeagueRow;
    for (let i = 0; i < STAT_KEYS.length; i++) {
      const fromPage = cleanStat(cells[i].map((w) => w.text).join(""));
      const fromCell = cleanStat(await readCell(workers.stat, image, bounds[i][0], bounds[i][1], y0, y1));
      row[STAT_KEYS[i]] = isStat(fromCell) ? fromCell : isStat(fromPage) ? fromPage : cells[i].map((w) => w.text).join(" ");
    }
    const left = nameLeft != null ? nameLeft - 0.005 : name[0]?.x0 ?? 0;
    const fromCell = cleanName(await readCell(workers.name, image, left, nameEnd - 0.005, y0, y1));
    row.ign = fromCell || cleanName(name.map((w) => w.text).join(" "));
    rows.push(row);
  }
  return rows;
}

// Reads the battle-record screenshots of one league, in order, into raw rows.
// The first run in a browser downloads the language packs, which takes a while.
export async function readBattleRecordImages(files: Blob[]): Promise<RawLeagueRow[]> {
  const workers = await getWorkers();
  const pages = [];
  for (const file of files) {
    const image = await prepare(file);
    const lines = await readLines(workers.page, image);
    pages.push({ image, lines, cols: measureColumns(lines, findHeader(lines)) });
  }

  // Every screenshot of a league has the same layout, so a page with too few
  // clean rows borrows the column positions measured on the others.
  const measured = pages.filter((p) => p.cols.samples > 0);
  const sharedNameLeft = median(pages.map((p) => p.cols.nameLeft).filter((v): v is number => v != null));
  const sharedStats = STAT_KEYS.map((_, i) =>
    median(measured.map((p) => p.cols.stats[i]).filter((v): v is number => v != null))
  );
  if (sharedStats.some((s) => s == null)) return [];

  const rows: RawLeagueRow[] = [];
  let unreadable = 0;
  for (const page of pages) {
    const nameLeft = page.cols.nameLeft ?? sharedNameLeft;
    const stats = (page.cols.samples >= 2 ? page.cols.stats : sharedStats) as number[];
    for (const row of await readPage(workers, page.image, page.lines, nameLeft, stats)) {
      if (!row.ign) row.ign = `(unreadable name ${++unreadable})`;
      rows.push(row);
    }
  }
  return rows;
}
