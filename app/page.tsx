"use client";

import { useState } from "react";

type Row = Record<string, string>;

export default function Home() {
  const [fields, setFields] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleExtract(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.currentTarget.elements.namedItem("pdfs") as HTMLInputElement);
    if (!input.files || !input.files.length) return alert("Select at least one PDF.");

    const fd = new FormData();
    Array.from(input.files).forEach((f) => fd.append("pdfs", f));

    setBusy(true);
    setStatus(`Processing ${input.files.length} file(s)...`);
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    const data = await res.json();
    setFields(data.fields);
    setRows(data.rows);
    setStatus(`Done. ${data.rows.length} row(s) extracted.`);
    setBusy(false);
  }

  async function download(format: "csv" | "xlsx") {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, format }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = format === "csv" ? "policies.csv" : "policies.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", margin: 40, color: "#222" }}>
      <h1>Health Insurance Policy PDF → Excel / CSV</h1>
      <p>Upload multiple policy PDFs. Fields are read from tables first, then text.</p>

      <form onSubmit={handleExtract}>
        <div style={{ border: "2px dashed #999", borderRadius: 10, padding: 30, textAlign: "center", background: "#fafafa" }}>
          <input type="file" name="pdfs" accept="application/pdf" multiple />
          <p>You can select many PDFs at once.</p>
        </div>
        <div style={{ display: "flex", gap: 10, margin: "18px 0" }}>
          <button type="submit" disabled={busy}>Extract</button>
          <button type="button" disabled={!rows.length} onClick={() => download("xlsx")}>Download Excel</button>
          <button type="button" disabled={!rows.length} onClick={() => download("csv")}>Download CSV</button>
        </div>
      </form>

      <div style={{ color: "#555" }}>{status}</div>

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 20, fontSize: 12 }}>
            <thead>
              <tr>{fields.map((f) => (
                <th key={f} style={{ border: "1px solid #ddd", padding: "6px 8px", background: "#f2f2f2", textAlign: "left" }}>{f}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{fields.map((f) => (
                  <td key={f} style={{ border: "1px solid #ddd", padding: "6px 8px", verticalAlign: "top" }}>{r[f] || ""}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}