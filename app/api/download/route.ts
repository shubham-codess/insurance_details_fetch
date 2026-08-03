import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { FIELDS } from "@/lib/extract";

export const runtime = "nodejs";

function toCsv(rows: Record<string, string>[]): string {
  const esc = (v: string) => {
    const s = (v ?? "").toString();
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = FIELDS.map(esc).join(",");
  const body = rows.map((r) => FIELDS.map((f) => esc(r[f] || "")).join(",")).join("\n");
  return "\uFEFF" + header + "\n" + body; // BOM for Excel
}

export async function POST(req: NextRequest) {
  const { rows, format } = (await req.json()) as {
    rows: Record<string, string>[];
    format: "csv" | "xlsx";
  };

  if (format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="policies.csv"',
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Policies");
  ws.addRow([...FIELDS]);
  for (const r of rows) ws.addRow(FIELDS.map((f) => r[f] || ""));
  ws.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="policies.xlsx"',
    },
  });
}