/* ============================================================
   Health Insurance Policy PDF -> structured rows
   Pure client-side. Uses pdf.js for parsing.
   ============================================================ */

(function () {
  "use strict";

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // ---- Column definition (order of output) ----
  var COLUMNS = [
    "File",
    "Policy Number",
    "Policyholder",
    "Policy Expiry Date & Time",
    "Pincode",
    "Mobile Number",
    "Sum Insured",
    "Total Available Sum Insured",
    "Gross Premium",
    "Total Premium",
    "Insured Person(s) Age"
  ];

  // ---- State ----
  var files = [];      // {file, status}
  var rows = [];       // extracted objects

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var drop = $("drop"), fileInput = $("file"), fileList = $("filelist");
  var btnProcess = $("process"), btnClear = $("clear");
  var btnXlsx = $("dlxlsx"), btnCsv = $("dlcsv");
  var statusBox = $("status"), statusText = $("statustext"), barFill = $("barfill");
  var tableWrap = $("tablewrap"), thead = $("thead"), tbody = $("tbody");

  // ============================================================
  //  File handling
  // ============================================================
  drop.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function (e) { addFiles(e.target.files); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  function addFiles(list) {
    Array.prototype.forEach.call(list, function (f) {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        files.push({ file: f, status: "wait" });
      }
    });
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = "";
    files.forEach(function (item, i) {
      var row = document.createElement("div");
      row.className = "fileitem";
      var stClass = item.status === "ok" ? "ok" : item.status === "err" ? "err" : "wait";
      var stText = item.status === "ok" ? "Parsed" : item.status === "err" ? "Failed" : "Ready";
      row.innerHTML =
        '<span>\uD83D\uDCC4</span>' +
        '<span class="nm">' + escapeHtml(item.file.name) + '</span>' +
        '<span class="st ' + stClass + '">' + stText + '</span>' +
        '<button class="rm" title="Remove" data-i="' + i + '">\u00d7</button>';
      fileList.appendChild(row);
    });
    fileList.querySelectorAll(".rm").forEach(function (b) {
      b.addEventListener("click", function () {
        files.splice(parseInt(this.getAttribute("data-i"), 10), 1);
        renderFileList();
        syncButtons();
      });
    });
    syncButtons();
  }

  function syncButtons() {
    btnProcess.disabled = files.length === 0;
    btnClear.disabled = files.length === 0 && rows.length === 0;
    btnXlsx.disabled = rows.length === 0;
    btnCsv.disabled = rows.length === 0;
  }

  btnClear.addEventListener("click", function () {
    files = []; rows = [];
    renderFileList(); renderTable();
    statusBox.classList.remove("show");
    syncButtons();
  });

  // ============================================================
  //  Processing
  // ============================================================
  btnProcess.addEventListener("click", async function () {
    if (!window.pdfjsLib) {
      alert("PDF library failed to load. Please check your internet connection and refresh.");
      return;
    }
    rows = [];
    statusBox.classList.add("show");
    btnProcess.disabled = true;
    for (var i = 0; i < files.length; i++) {
      var item = files[i];
      setStatus("Reading " + item.file.name + " (" + (i + 1) + "/" + files.length + ")\u2026",
        (i / files.length) * 100);
      try {
        var parsed = await parsePdf(item.file);
        var rec = extractFields(parsed, item.file.name);
        rows.push(rec);
        item.status = "ok";
      } catch (err) {
        console.error(err);
        item.status = "err";
        rows.push({ "File": item.file.name });
      }
      renderFileList();
    }
    setStatus("Done \u2014 " + rows.length + " policy record(s) extracted.", 100);
    renderTable();
    syncButtons();
    btnProcess.disabled = files.length === 0;
  });

  function setStatus(txt, pct) {
    statusText.textContent = txt;
    barFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  // ============================================================
  //  PDF parsing -> lines + tabular structure per page
  // ============================================================
  async function parsePdf(file) {
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    var pages = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var items = tc.items.map(function (it) {
        return {
          str: (it.str || "").trim(),
          x: it.transform[4],
          y: it.transform[5],
          w: it.width || 0
        };
      }).filter(function (it) { return it.str.length > 0; });
      pages.push(buildLines(items));
    }
    return pages; // array of pages, each = array of lines; each line = array of cells {str,x,w}
  }

  // Group text items into visual rows by y, then sort cells left-to-right.
  function buildLines(items) {
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    var TOL = 3; // y tolerance in pt
    items.forEach(function (it) {
      var line = null;
      for (var i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
        if (Math.abs(lines[i].y - it.y) <= TOL) { line = lines[i]; break; }
      }
      if (!line) { line = { y: it.y, cells: [] }; lines.push(line); }
      line.cells.push({ str: it.str, x: it.x, w: it.w });
    });
    lines.forEach(function (ln) {
      ln.cells.sort(function (a, b) { return a.x - b.x; });
      ln.text = ln.cells.map(function (c) { return c.str; }).join(" ").replace(/\s+/g, " ").trim();
    });
    return lines;
  }

  // ============================================================
  //  Field extraction
  //  Strategy: reconstruct visual lines (pdf.js text items grouped by
  //  y-coordinate, joined left-to-right), then apply layout-aware
  //  patterns. Values that live in a table ROW under a header (Total
  //  Available Sum Insured, Total Premium) are read positionally, not
  //  as "number immediately after the label".
  // ============================================================
  function extractFields(pages, sourceName) {
    var lineArr = [];
    pages.forEach(function (lines) {
      lines.forEach(function (l) { lineArr.push(l.text); });
    });
    var full = lineArr.join("\n");
    var rec = { "File": sourceName };
    var m;

    // --- Policy Number ---
    // Prefer the fully-qualified token with plan suffix (e.g.
    // MLF0026533000107/MIG3/Classic); fall back to value near a label.
    m = full.match(/\b([A-Z]{2,}\d{5,}(?:\/[A-Za-z0-9]+)+)/);
    if (!m) m = full.match(/Policy\s*(?:Certificate\s*)?(?:No|Number)\.?\s*[:\-]?\s*([A-Z]{2,}\d{3,}[A-Z0-9\/\-]*)/i);
    if (!m) m = full.match(/Certificate\s*(?:No|Number)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{4,})/i);
    rec["Policy Number"] = m ? m[1].trim() : "";

    // --- Policyholder --- capture the name on the SAME line as the label
    // (do not cross the newline into the address), else use the salutation.
    m = full.match(/Policy\s*Holder(?:'?s)?(?:\s*Name)?[ \t]*[:\-]?[ \t]*([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z.]+){0,5})/);
    if (!m) m = full.match(/Proposer(?:'?s)?\s*Name[ \t]*[:\-]?[ \t]*([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z.]+){0,5})/);
    if (!m) m = full.match(/Insured\s*Name[ \t]*[:\-]?[ \t]*([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z.]+){0,5})/);
    if (!m) m = full.match(/Dear[ \t]+([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z.]+){0,5})[ \t]*,/);
    rec["Policyholder"] = m ? m[1].replace(/\s+/g, " ").trim() : "";

    // --- Policy Expiry Date & Time -> DD-MM-YYYY HH:MM ---
    m = full.match(/Policy\s*Expiry\s*Date\s*(?:and|&)?\s*Time\s*[:\-]?\s*(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\s*(\d{2}):(\d{2})/i);
    if (!m) m = full.match(/(?:Expiry|Expiration|Valid\s*(?:Up\s*to|Till|Until))\D{0,25}?(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\s*(\d{2}):(\d{2})/i);
    rec["Policy Expiry Date & Time"] = m ? (m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5]) : "";

    // --- Pincode ---
    m = full.match(/Pin\s*[- ]?\s*code\s*[:\-]?\s*(\d{6})\b/i) || full.match(/\bPIN\s*[:\-]?\s*(\d{6})\b/);
    rec["Pincode"] = m ? m[1] : "";

    // --- Mobile Number --- skip company/toll-free header lines so the
    // policyholder's own number is picked, not the insurer's helpline.
    var mob = "";
    for (var i = 0; i < lineArr.length; i++) {
      var ln = lineArr[i];
      if (/mobile/i.test(ln) && !/toll|website|registration|royalsundaram|customer\s*care|helpline|grievance/i.test(ln)) {
        var mm = ln.match(/Mobile\s*(?:No\.?|Number)?\s*[:\-]?\s*(?:\+?91[\-\s]?)?([6-9]\d{9})\b/i);
        if (mm) { mob = mm[1]; break; }
      }
    }
    if (!mob) {
      var mm2 = full.match(/(?:Mobile|Contact\s*No|Phone|Cell)\s*(?:No\.?|Number)?\s*[:\-]?\s*(?:\+?91[\-\s]?)?([6-9]\d{9})\b/i);
      if (mm2) mob = mm2[1];
    }
    rec["Mobile Number"] = mob;

    // --- Sum Insured (base) --- first "Sum Insured <number>" occurrence,
    // which is the certificate-level figure (300,000).
    m = full.match(/Sum\s*Insured\s*[:\-]?\s*(?:Rs\.?|INR|\u20b9)?\s*([\d,]{4,})/i);
    rec["Sum Insured"] = m ? m[1].replace(/,/g, "") : "";

    // --- Total Available Sum Insured --- header label; the value sits in
    // the first data row below it. Take the LAST number of that row
    // (Base SI + No-Claim-Bonus = Total Available).
    var tav = "";
    var idx = full.search(/Total\s*Available\s*Sum\s*Insured/i);
    if (idx < 0) idx = full.search(/Total\s*Sum\s*Insured/i);
    if (idx >= 0) {
      var after = full.slice(idx).split("\n").slice(1);
      for (var r = 0; r < after.length; r++) {
        var nums = after[r].match(/\d[\d,]*(?:\.\d+)?/g);
        if (/[A-Za-z]/.test(after[r]) && nums && nums.length) {
          tav = nums[nums.length - 1].replace(/,/g, "");
          break;
        }
      }
    }
    rec["Total Available Sum Insured"] = tav;

    // --- Gross Premium & Total Premium --- premium table row
    // "Amount ( in Rs ) <Gross> <GST> <Total>". Gross = 1st, Total = 3rd.
    m = full.match(/Amount\s*\(\s*in[^)]*\)\s*([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/i);
    if (m) {
      rec["Gross Premium"] = m[1].replace(/,/g, "");
      rec["Total Premium"] = m[3];
    } else {
      var g = full.match(/Gross\s*Premium\s*(?:\(.*?\))?\s*[:\-]?\s*(?:Rs\.?|INR|\u20b9)?\s*([\d,]+(?:\.\d+)?)/i);
      if (!g) g = full.match(/Net\s*Premium\s*(?:\(.*?\))?\s*[:\-]?\s*(?:Rs\.?|INR|\u20b9)?\s*([\d,]+(?:\.\d+)?)/i);
      var t = full.match(/Total\s*Premium\s*(?:\(.*?\))?\s*[:\-]?\s*(?:Rs\.?|INR|\u20b9)?\s*([\d,]+(?:\.\d+)?)/i);
      if (!t) t = full.match(/(?:Premium\s*)?(?:Amount\s*)?Payable\s*(?:\(.*?\))?\s*[:\-]?\s*(?:Rs\.?|INR|\u20b9)?\s*([\d,]+(?:\.\d+)?)/i);
      rec["Gross Premium"] = g ? g[1].replace(/,/g, "") : "";
      rec["Total Premium"] = t ? t[1] : "";
    }

    // --- Insured Person(s) Age ---
    rec["Insured Person(s) Age"] = extractAges(pages, full);

    return rec;
  }

  // ============================================================
  //  Age extraction
  //  Primary: the number sitting between a DOB (dd/mm/yyyy) and the
  //  Gender token on each insured row -> that is the AGE column value.
  //  Fallback: locate an explicit "Age" header column and read down it.
  // ============================================================
  function extractAges(pages, full) {
    var ages = [];
    var rx = /\d{2}[\/\-]\d{2}[\/\-]\d{4}\s+(\d{1,3})\s+(?:Male|Female|M|F)\b/gi;
    var a;
    while ((a = rx.exec(full)) !== null) {
      var n = parseInt(a[1], 10);
      if (!isNaN(n) && n >= 0 && n <= 120) ages.push(String(n));
    }
    if (ages.length) return ages.join(", ");
    return extractAgesByColumn(pages);
  }

  function extractAgesByColumn(pages) {
    var ages = [];
    pages.forEach(function (lines) {
      for (var li = 0; li < lines.length; li++) {
        var cells = lines[li].cells;
        var ageCol = null;
        for (var ci = 0; ci < cells.length; ci++) {
          if (/^age(?:\s*\(?(?:yrs?|years?)\)?)?$/i.test(cells[ci].str.trim())) {
            ageCol = { x: cells[ci].x, w: cells[ci].w || 20 };
            var leftBound = -Infinity, rightBound = Infinity;
            if (ci > 0) leftBound = (cells[ci - 1].x + cells[ci].x) / 2;
            if (ci < cells.length - 1) rightBound = (cells[ci].x + cells[ci + 1].x) / 2;
            ageCol.left = leftBound; ageCol.right = rightBound;
            break;
          }
        }
        if (ageCol) {
          for (var rr = li + 1; rr < lines.length; rr++) {
            var rowCells = lines[rr].cells;
            if (!rowCells.length) break;
            var got = pickInColumn(rowCells, ageCol);
            if (got !== null) {
              var nn = parseInt(got, 10);
              if (!isNaN(nn) && nn >= 0 && nn <= 120) ages.push(String(nn));
            }
          }
        }
      }
    });
    return ages.join(", ");
  }

  function pickInColumn(cells, col) {
    for (var i = 0; i < cells.length; i++) {
      var cx = cells[i].x + (cells[i].w || 0) / 2;
      if (cx >= col.left && cx <= col.right) {
        var s = cells[i].str.trim();
        var m = s.match(/^(\d{1,3})(?:\s*(?:yrs?|years?))?$/i);
        if (m) return m[1];
      }
    }
    return null;
  }

  // ============================================================
  //  Render results table
  // ============================================================
  function renderTable() {
    if (!rows.length) { tableWrap.classList.remove("show"); return; }
    tableWrap.classList.add("show");
    thead.innerHTML = COLUMNS.map(function (c) { return "<th>" + escapeHtml(c) + "</th>"; }).join("");
    tbody.innerHTML = rows.map(function (r) {
      return "<tr>" + COLUMNS.map(function (c) {
        var v = r[c] != null ? String(r[c]) : "";
        if (v === "") return '<td class="miss">\u2014</td>';
        return "<td>" + escapeHtml(v) + "</td>";
      }).join("") + "</tr>";
    }).join("");
  }

  // ============================================================
  //  Exports
  // ============================================================
  function buildMatrix() {
    var data = [COLUMNS.slice()];
    rows.forEach(function (r) {
      data.push(COLUMNS.map(function (c) { return r[c] != null ? String(r[c]) : ""; }));
    });
    return data;
  }

  btnXlsx.addEventListener("click", function () {
    if (!window.XLSX) { alert("Excel library failed to load. Check internet and refresh."); return; }
    var ws = XLSX.utils.aoa_to_sheet(buildMatrix());
    ws["!cols"] = COLUMNS.map(function (c) { return { wch: Math.max(14, c.length + 4) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Policies");
    XLSX.writeFile(wb, "policy_details_" + stamp() + ".xlsx");
  });

  btnCsv.addEventListener("click", function () {
    var matrix = buildMatrix();
    var csv = matrix.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell == null ? "" : cell);
        if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(",");
    }).join("\r\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "policy_details_" + stamp() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---- helpers ----
  function stamp() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  syncButtons();
})();
