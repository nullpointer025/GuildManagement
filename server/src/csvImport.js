// Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes, commas/newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const HEADER_MAP = {
  player: "ign",
  ign: "ign",
  "lv.": "level",
  lv: "level",
  level: "level",
  class: "class",
  title: "title",
  gender: "gender",
  position: "position",
  "gear score": "gear_score",
  "combat power": "gear_score",
  weekly: "weekly",
  "weekly contribution": "weekly_contribution",
  "total contribution": "total_contribution",
  "online status": "online_status",
};

const NUMERIC_FIELDS = new Set([
  "level",
  "gear_score",
  "weekly",
  "weekly_contribution",
  "total_contribution",
]);

function toNumberOrNull(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parsePlayersCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error("CSV file is empty");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const fieldIndexes = {};
  header.forEach((h, idx) => {
    const mapped = HEADER_MAP[h];
    if (mapped) fieldIndexes[mapped] = idx;
  });

  if (fieldIndexes.ign == null) {
    throw new Error('CSV must include a "Player" column with the character name');
  }

  const players = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ign = (r[fieldIndexes.ign] ?? "").trim();
    if (!ign) continue;

    const record = { ign };
    for (const [field, idx] of Object.entries(fieldIndexes)) {
      if (field === "ign") continue;
      const raw = r[idx] != null ? r[idx].trim() : null;
      record[field] = NUMERIC_FIELDS.has(field) ? toNumberOrNull(raw) : raw;
    }
    players.push(record);
  }
  return players;
}
