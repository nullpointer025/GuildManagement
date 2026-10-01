import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tesseract language packs, e.g. "eng" or "eng+jpn+tha". Each extra language helps
// read names in that script but slows reading down. Packs are downloaded once on
// first use and cached in server/data/ocr.
const LANGS = (process.env.OCR_LANGS || "eng").split("+").map((l) => l.trim()).filter(Boolean);
const CACHE_PATH = path.join(__dirname, "..", "data", "ocr");

// A stat as OCR reads it: "140", "1,234", "12.3M", "790.0M", "5K".
const STAT_TOKEN = /^\d[\d,.]*[KMB]?$/i;

let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      fs.mkdirSync(CACHE_PATH, { recursive: true });
      const worker = await createWorker(LANGS, undefined, { cachePath: CACHE_PATH });
      // One uniform block keeps each table row on one text line instead of
      // splitting the columns apart.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Game screenshots are light text on a dark, textured background. Tesseract reads
// dark text on white best, at roughly 30px+ text height.
async function prepare(buffer) {
  const image = sharp(buffer).rotate().grayscale();
  const { width = 0 } = await image.metadata();
  const { channels } = await image.clone().stats();
  let pipeline = image;
  if (width > 0 && width < 2400) pipeline = pipeline.resize({ width: width * 2, kernel: "lanczos3" });
  if (channels[0].mean < 128) pipeline = pipeline.negate({ alpha: false });
  return pipeline.normalize().png().toBuffer();
}

// Fixes letters OCR commonly reads instead of digits, only inside a stat token.
function cleanStatToken(token) {
  let t = token.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  // "12,3M" is "12.3M" read with a comma.
  t = t.replace(/^(\d+),(\d)([KMB])$/i, "$1.$2$3");
  // The game shows K/M/B values with one decimal ("790.0M"), so "251M" is "25.1M"
  // with the dot missed.
  t = t.replace(/^(\d+)(\d)([KMB])$/i, "$1.$2$3");
  return t;
}

// Splits one OCR line into a player row, or null when it isn't one (headers, titles,
// the league summary). A row is a name followed by at least four stats: Kill,
// Assist, Player Damage, Building Damage.
export function parseOcrLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  let start = tokens.length;
  while (start > 0 && STAT_TOKEN.test(cleanStatToken(tokens[start - 1]))) start--;
  const stats = tokens.slice(start).map(cleanStatToken);
  if (stats.length < 4) return null;

  const nameTokens = tokens.slice(0, start);
  // Drop a leading rank number and stray symbols OCR makes of class/rank icons.
  if (nameTokens.length > 1 && /^#?\d+\.?$/.test(nameTokens[0])) nameTokens.shift();
  while (nameTokens.length > 1 && !/[\p{L}\p{N}]/u.test(nameTokens[0])) nameTokens.shift();
  const ign = nameTokens.join(" ").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!ign) return null;

  const [kills, assists, playerDamage, buildingDamage] = stats;
  return { ign, kills, assists, player_damage: playerDamage, building_damage: buildingDamage };
}

async function readImage(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(await prepare(buffer));
  return data.text.split("\n").map(parseOcrLine).filter(Boolean);
}

// Reads the battle-record screenshots of one league, in upload order, into raw rows
// for parseLeagueRows. Jobs run one at a time on a shared worker.
export function readBattleRecordImages(buffers) {
  const job = queue.then(async () => {
    const rows = [];
    for (const buffer of buffers) rows.push(...(await readImage(buffer)));
    return rows;
  });
  queue = job.catch(() => {});
  return job;
}
