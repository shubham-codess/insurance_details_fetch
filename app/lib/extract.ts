import PDFParser from "pdf2json";

export const FIELDS = [
  "Policy Number",
  "Policyholder",
  "Policy Expiry Date and Time",
  "Pincode",
  "Policyholder Mobile Number",
  "Base Sum Insured",
  "Total Available Sum Insured",
  "Gross Premium",
  "Total Premium",
  "Insured Person(s) Age",
  "Source File",
] as const;

export type Row = Record<string, string>;

interface Item { x: number; y: number; text: string; page: number }
interface Line { page: number; y: number; items: Item[]; text: string }

function parseBuffer(buffer: Buffer): Promise<any> {
  return new Promise((resolve, reject) => {
    const parser: any = new (PDFParser as any)(null, 1);
    parser.on("pdfParser_dataError", (e: any) => reject(e.parserError));
    parser.on("pdfParser_dataReady", (data: any) => resolve(data));
    parser.parseBuffer(buffer);
  });
}

function getItems(data: any): Item[] {
  const items: Item[] = [];
  (data.Pages || []).forEach((p: any, pi: number) => {
    (p.Texts || []).forEach((t: any) => {
      const text = (t.R || [])
        .map((r: any) => {
          try { return decodeURIComponent(r.T); } catch { return r.T; }
        })
        .join("");
      if (text.trim()) items.push({ x: t.x, y: t.y, text, page: pi });
    });
  });
  return items;
}

function getLines(items: Item[]): Line[] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.page + ":" + it.y.toFixed(1);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  const lines: Line[] = [...map.entries()].map(([key, its]) => {
    its.sort((a, b) => a.x - b.x);
    const [page, y] = key.split(":").map(Number);
    return {
      page,
      y,
      items: its,
      text: its.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim(),
    };
  });
  lines.sort((a, b) => a.page - b.page || a.y - b.y);
  return lines;
}

function searchText(patterns: RegExp[], text: string): string {
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) return m[1].replace(/\s+/g, " ").replace(/^[:\-\s]+|[:\-\s]+$/g, "").trim();
  }
  return "";
}

// Find a labelled value on the same line (value follows the label text).
function findLabeled(aliases: string[], lines: Line[]): string {
  const al = aliases.map((a) => a.toLowerCase());
  for (const line of lines) {
    const lower = line.text.toLowerCase();
    for (const a of al) {
      const idx = lower.indexOf(a);
      if (idx !== -1) {
        const after = line.text.slice(idx + a.length).replace(/^[:\-\s]+/, "").trim();
        if (after) return after.split("  ")[0].trim();
      }
    }
  }
  return "";
}

// Collect every numeric value under a column whose header cell reads "Age".
function extractAges(lines: Line[]): string {
  const ages: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].items.find((it) => /^age$/i.test(it.text.trim()));
    if (!header) continue;
    const colX = header.x;
    for (let j = i + 1; j < lines.length && lines[j].page === lines[i].page; j++) {
      const cell = lines[j].items.find(
        (it) => Math.abs(it.x - colX) < 1.5 && /^\d{1,3}$/.test(it.text.trim())
      );
      if (cell) ages.push(cell.text.trim());
    }
  }
  return ages.join(", ");
}

export async function extractFromBuffer(filename: string, buffer: Buffer): Promise<Row> {
  const data = await parseBuffer(buffer);
  const items = getItems(data);
  const lines = getLines(items);
  const fullText = lines.map((l) => l.text).join("\n");

  const row: Row = {};
  for (const f of FIELDS) row[f] = "";
  row["Source File"] = filename;

  row["Policy Number"] =
    findLabeled(["policy no", "policy number", "certificate no", "policy / certificate no"], lines) ||
    searchText([/Policy\s*(?:No|Number|\/?\s*Certificate No)\.?\s*[:\-]?\s*([A-Z0-9\/\-]+)/i], fullText);

  row["Policyholder"] =
    findLabeled(["policy holder", "policyholder", "proposer name", "insured name", "name of proposer"], lines) ||
    searchText([/(?:Policy\s*Holder|Policyholder|Proposer(?:'s)? Name|Insured Name|Name of (?:the )?(?:Proposer|Policyholder))\s*[:\-]?\s*([A-Za-z][A-Za-z .]+)/i], fullText);

  row["Policy Expiry Date and Time"] =
    findLabeled(["expiry", "policy end", "valid upto", "period of insurance to", "end date"], lines) ||
    searchText([/(?:Policy\s*)?(?:Expiry(?:\s*Date)?|End Date|Valid\s*Up\s*to|Period of Insurance\s*To)\s*[:\-]?\s*([0-9]{1,2}[\/\-.][A-Za-z0-9]{2,4}[\/\-.][0-9]{2,4}(?:\s*(?:at\s*)?[0-9]{1,2}[:.][0-9]{2}\s*(?:AM|PM|Hrs)?)?)/i], fullText);

  let pin = findLabeled(["pincode", "pin code", "pin"], lines) ||
    searchText([/(?:Pin\s*Code|Pincode|PIN)\s*[:\-]?\s*(\d{6})/i], fullText);
  const pinM = pin.match(/\d{6}/);
  row["Pincode"] = pinM ? pinM[0] : pin;

  let mob = findLabeled(["mobile", "mobile no", "contact no", "phone"], lines) ||
    searchText([/(?:Mobile|Phone|Contact)\s*(?:No|Number)?\.?\s*[:\-]?\s*(\+?\d[\d \-]{8,13})/i], fullText);
  const mobM = mob.match(/\+?\d[\d \-]{8,13}/);
  row["Policyholder Mobile Number"] = mobM ? mobM[0].trim() : mob;

  row["Base Sum Insured"] =
    findLabeled(["base sum insured"], lines) ||
    searchText([/Base\s*Sum\s*Insured\s*[:\-]?\s*(?:Rs\.?|INR)?\s*([\d,]+)/i], fullText);

  row["Total Available Sum Insured"] =
    findLabeled(["total available sum insured", "available sum insured"], lines) ||
    searchText([/Total\s*Available\s*Sum\s*Insured\s*[:\-]?\s*(?:Rs\.?|INR)?\s*([\d,]+)/i], fullText);

  row["Gross Premium"] =
    findLabeled(["gross premium"], lines) ||
    searchText([/Gross\s*Premium\s*[:\-]?\s*(?:Rs\.?|INR)?\s*([\d,.]+)/i], fullText);

  row["Total Premium"] =
    findLabeled(["total premium"], lines) ||
    searchText([/Total\s*Premium\s*[:\-]?\s*(?:Rs\.?|INR)?\s*([\d,.]+)/i], fullText);

  row["Insured Person(s) Age"] = extractAges(lines);

  return row;
}