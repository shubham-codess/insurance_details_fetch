import { NextRequest, NextResponse } from "next/server";
import { extractFromBuffer, FIELDS } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("pdfs") as File[];
  const rows = [];

  for (const f of files) {
    if (!f || !f.name.toLowerCase().endsWith(".pdf")) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    try {
      rows.push(await extractFromBuffer(f.name, buf));
    } catch (e: any) {
      const err: Record<string, string> = {};
      for (const k of FIELDS) err[k] = "";
      err["Source File"] = f.name;
      err["Policy Number"] = "ERROR: " + (e?.message || String(e));
      rows.push(err);
    }
  }

  return NextResponse.json({ fields: FIELDS, rows });
}