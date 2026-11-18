// A small .xlsx reader for the battle-record export, so the file never has to be
// uploaded. An .xlsx is a zip of XML files; this unzips the first worksheet and the
// shared-string table with the browser's own DecompressionStream and reads the
// cells as text, row by row.

const u16 = (v: DataView, at: number) => v.getUint16(at, true);
const u32 = (v: DataView, at: number) => v.getUint32(at, true);

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Every file in the zip by name, decompressed on demand.
function readZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  // The end-of-central-directory record sits in the last 64KB (it may end in a comment).
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This isn't an .xlsx file");

  const count = u16(view, eocd + 10);
  let at = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<string>>();
  for (let n = 0; n < count; n++) {
    if (u32(view, at) !== 0x02014b50) throw new Error("The .xlsx file is damaged");
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLen = u16(view, at + 28);
    const local = u32(view, at + 42);
    const name = decoder.decode(new Uint8Array(buffer, at + 46, nameLen));
    at += 46 + nameLen + u16(view, at + 30) + u16(view, at + 32);

    entries.set(name, async () => {
      const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
      const raw = new Uint8Array(buffer, start, size);
      if (method === 0) return decoder.decode(raw);
      if (method === 8) return decoder.decode(await inflate(raw));
      throw new Error("The .xlsx file uses an unsupported compression");
    });
  }
  return entries;
}

const parseXml = (text: string) => new DOMParser().parseFromString(text, "application/xml");

// Text of a shared/inline string, skipping phonetic hints (<rPh>).
function stringText(el: Element) {
  return Array.from(el.getElementsByTagName("t"))
    .filter((t) => t.parentElement?.tagName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");
}

// "AB12" -> 27 (zero-based column index).
function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// The first worksheet's path, as the workbook lists it.
async function firstSheetPath(files: Map<string, () => Promise<string>>) {
  const fallback = "xl/worksheets/sheet1.xml";
  const workbook = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return fallback;
  const sheet = parseXml(await workbook()).getElementsByTagName("sheet")[0];
  const relId =
    sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
    sheet?.getAttribute("r:id");
  const rel = Array.from(parseXml(await rels()).getElementsByTagName("Relationship")).find(
    (r) => r.getAttribute("Id") === relId
  );
  const target = rel?.getAttribute("Target");
  if (!target) return fallback;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

// The first worksheet as rows of cell text ("" for empty cells).
export async function readFirstSheet(file: Blob): Promise<string[][]> {
  const files = readZip(await file.arrayBuffer());
  const path = await firstSheetPath(files);
  const sheet = files.get(path);
  if (!sheet) throw new Error("The .xlsx file has no worksheet");

  const sharedFile = files.get("xl/sharedStrings.xml");
  const shared = sharedFile
    ? Array.from(parseXml(await sharedFile()).getElementsByTagName("si")).map(stringText)
    : [];

  const rows: string[][] = [];
  for (const row of Array.from(parseXml(await sheet()).getElementsByTagName("row"))) {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((c, i) => {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : i;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let text: string;
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = stringText(c);
      else text = v;
      while (cells.length < col) cells.push("");
      cells[col] = text;
    });
    rows.push(cells);
  }
  return rows;
}
