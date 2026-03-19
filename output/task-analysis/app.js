const $ = (sel) => document.querySelector(sel);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeNewlines(text) {
  return (text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function safeTrim(s) {
  return (s ?? "").toString().trim();
}

function parseDateLike(s) {
  const t = safeTrim(s);
  // Accept YYYY-MM-DD, 20XX-03-19 etc. Return ISO date string if possible.
  const m = t.match(/(\d{4}|\d{2}XX)\-(\d{2})\-(\d{2})/);
  if (!m) return null;
  const yyyyRaw = m[1];
  if (yyyyRaw.includes("X")) return `${yyyyRaw}-${m[2]}-${m[3]}`;
  const yyyy = Number(yyyyRaw);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseTimeHHMM(s) {
  const t = safeTrim(s);
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatMinutes(mins) {
  if (mins == null || Number.isNaN(mins)) return "—";
  const sign = mins < 0 ? "-" : "";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}m`;
}

function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function tokenizeJP(s) {
  // Lightweight: split by spaces and punctuation; keep Japanese words as chunks.
  const t = safeTrim(s)
    .replace(/[()\[\]{}「」『』【】]/g, " ")
    .replace(/[。、・，,.!！?？:：;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  return t.split(" ").filter(Boolean);
}

function statusNormalize(raw) {
  const t = safeTrim(raw);
  if (!t) return { key: "other", label: "その他", percent: null, raw: "" };
  if (t.includes("完了")) return { key: "done", label: "完了", percent: 100, raw: t };
  if (t.includes("レビュー待ち") || t.includes("回収待ち")) return { key: "waiting_review", label: "レビュー待ち", percent: null, raw: t };
  if (t.includes("継続")) return { key: "ongoing", label: "継続", percent: null, raw: t };
  const pm = t.match(/(\d{1,3})\s*%/);
  if (pm) {
    const p = clamp(Number(pm[1]), 0, 100);
    return { key: "percent", label: "%", percent: p, raw: t };
  }
  return { key: "other", label: "その他", percent: null, raw: t };
}

function inferDateFromFilename(name) {
  const n = safeTrim(name);
  // Patterns: 20xx0319, 20260319, 20XX-03-19, etc.
  const m1 = n.match(/(\d{4}|\d{2}xx|\d{2}XX)(\d{2})(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`.replace(/^(\d{2})xx/i, "$1XX");
  const m2 = n.match(/(\d{4}|\d{2}XX)\-(\d{2})\-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parseMarkdownDailySections(text) {
  const t = normalizeNewlines(text);

  // Split combined reports into day chunks; accept "## 日報" boundaries.
  const parts = t.split(/\n(?=##\s*日報\s*$)/g);
  if (parts.length === 1) {
    return [t];
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseWorkLine(line) {
  // - **稼働**: 09:30〜18:15（休憩: 01:00）
  const m = line.match(/\*\*稼働\*\*\s*:\s*([0-9:]{3,5})\s*[〜~]\s*([0-9:]{3,5}).*?\(\s*休憩\s*:\s*([0-9:]{3,5})\s*\)/);
  if (!m) return null;
  const startMin = parseTimeHHMM(m[1]);
  const endMin = parseTimeHHMM(m[2]);
  const breakMin = parseTimeHHMM(m[3]);
  if (startMin == null || endMin == null || breakMin == null) return null;
  let dur = endMin - startMin - breakMin;
  // If end is next day (rare), allow wrap.
  if (dur < 0) dur = (endMin + 24 * 60) - startMin - breakMin;
  return { startMin, endMin, breakMin, workMin: dur };
}

function parseTemplateStyleDaily(text, sourceName = "") {
  const t = normalizeNewlines(text);
  const lines = t.split("\n");

  let date = null;
  let work = null;
  const tasks = [];
  const issues = [];
  const plans = [];
  const warnings = [];

  // Extract basic info
  for (const line of lines) {
    if (!date) {
      const dm = line.match(/\*\*日付\*\*\s*:\s*(.+)$/);
      if (dm) date = parseDateLike(dm[1]);
    }
    if (!work && line.includes("**稼働**")) {
      const w = parseWorkLine(line);
      if (w) work = w;
    }
  }
  if (!date) {
    const inferred = inferDateFromFilename(sourceName);
    if (inferred) date = inferred;
  }

  // State machine around sections.
  let section = null; // "tasks" | "issues" | "plans"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^###\s*2\.\s*今日の実績/.test(line)) section = "tasks";
    else if (/^###\s*3\.\s*課題/.test(line)) section = "issues";
    else if (/^###\s*4\.\s*明日の予定/.test(line)) section = "plans";
    else if (/^###\s*\d+\./.test(line)) section = null;

    if (section === "tasks") {
      const tm = line.match(/^\-\s*\*\*タスク\/案件\*\*\s*:\s*(.+)$/);
      if (tm) {
        const task = {
          name: safeTrim(tm[1]),
          purpose: "",
          details: "",
          output: "",
          progressRaw: "",
          progress: statusNormalize(""),
        };
        // Scan indented sub-bullets until next task or section
        for (let j = i + 1; j < lines.length; j++) {
          const l2 = lines[j];
          if (/^\-\s*\*\*タスク\/案件\*\*/.test(l2) || /^###\s*\d+\./.test(l2)) {
            i = j - 1;
            break;
          }
          const mPurpose = l2.match(/^\s*\-\s*\*\*目的\*\*\s*:\s*(.+)$/);
          const mDetails = l2.match(/^\s*\-\s*\*\*実施内容\*\*\s*:\s*(.+)$/);
          const mOutput = l2.match(/^\s*\-\s*\*\*成果\/アウトプット\*\*\s*:\s*(.+)$/);
          const mProgress = l2.match(/^\s*\-\s*\*\*進捗\*\*\s*:\s*(.+)$/);
          if (mPurpose) task.purpose = safeTrim(mPurpose[1]);
          if (mDetails) task.details = safeTrim(mDetails[1]);
          if (mOutput) task.output = safeTrim(mOutput[1]);
          if (mProgress) task.progressRaw = safeTrim(mProgress[1]);
        }
        task.progress = statusNormalize(task.progressRaw);
        tasks.push(task);
      }
    } else if (section === "issues") {
      const im = line.match(/^\-\s*\*\*課題\*\*\s*:\s*(.+)$/);
      if (im) issues.push(safeTrim(im[1]));
    } else if (section === "plans") {
      const pm = line.match(/^\-\s*\*\*P([123])\*\*\s*:\s*(.+)$/);
      if (pm) plans.push({ priority: `P${pm[1]}`, text: safeTrim(pm[2]) });
    }
  }

  if (!tasks.length && t.includes("タスク/案件") === false) {
    warnings.push("テンプレ形式のタスクが見つかりませんでした（生テキスト扱いになるかもしれません）。");
  }
  if (!date) warnings.push(`日付が抽出できませんでした（source=${sourceName || "貼り付け"}）。`);

  return {
    kind: "daily",
    sourceName: sourceName || "貼り付け",
    date,
    work,
    tasks,
    issues,
    plans,
    warnings,
    raw: t,
  };
}

function parseRawBulletText(text, sourceName = "") {
  const t = normalizeNewlines(text);
  const lines = t.split("\n").map((l) => safeTrim(l)).filter(Boolean);

  const date = inferDateFromFilename(sourceName);
  const tasks = lines.map((l) => ({
    name: l.replace(/^[\-\*\u2022]\s*/, ""),
    purpose: "",
    details: "",
    output: "",
    progressRaw: "",
    progress: statusNormalize(""),
  }));

  const warnings = [];
  if (!date) warnings.push(`日付が抽出できませんでした（source=${sourceName || "貼り付け"}）。`);

  return {
    kind: "daily",
    sourceName: sourceName || "貼り付け",
    date,
    work: null,
    tasks,
    issues: [],
    plans: [],
    warnings,
    raw: t,
  };
}

function parseAny(text, sourceName = "") {
  const t = normalizeNewlines(text);
  const hasTemplateMarkers = /\*\*タスク\/案件\*\*/.test(t) || /\*\*日付\*\*/.test(t);
  if (hasTemplateMarkers) {
    const chunks = parseMarkdownDailySections(t);
    if (chunks.length === 1) return [parseTemplateStyleDaily(chunks[0], sourceName)];
    return chunks.map((c, idx) => parseTemplateStyleDaily(c, `${sourceName || "日報"}#${idx + 1}`));
  }
  return [parseRawBulletText(t, sourceName)];
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  return map;
}

function sortDateKey(a, b) {
  // Nulls last
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function applyFilters(records, filters) {
  const from = filters.from || null;
  const to = filters.to || null;
  const status = filters.status || "";
  const q = safeTrim(filters.query).toLowerCase();
  const hideUnknownDate = !!filters.hideUnknownDate;

  const out = [];
  for (const r of records) {
    if (hideUnknownDate && !r.date) continue;
    if (from && r.date && r.date < from) continue;
    if (to && r.date && r.date > to) continue;

    const tasks = r.tasks.filter((t) => {
      if (status && t.progress.key !== status) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });

    // If filtering removes all tasks, still keep the day if it has issues/plans? keep it if tasks match.
    if (status || q) {
      if (!tasks.length) continue;
    }

    out.push({ ...r, tasks });
  }
  return out;
}

function aggregate(records) {
  const allTasks = records.flatMap((r) =>
    r.tasks.map((t) => ({
      date: r.date,
      sourceName: r.sourceName,
      ...t,
    })),
  );

  const taskCounts = new Map();
  for (const t of allTasks) {
    const k = t.name || "（無題）";
    taskCounts.set(k, (taskCounts.get(k) ?? 0) + 1);
  }
  const taskCountRows = Array.from(taskCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const statusCounts = new Map([
    ["done", 0],
    ["waiting_review", 0],
    ["ongoing", 0],
    ["percent", 0],
    ["other", 0],
  ]);
  for (const t of allTasks) {
    statusCounts.set(t.progress.key, (statusCounts.get(t.progress.key) ?? 0) + 1);
  }
  const statusRows = Array.from(statusCounts.entries()).map(([key, count]) => ({ key, count }));

  const workByDate = new Map();
  for (const r of records) {
    if (!r.date) continue;
    if (!r.work?.workMin && r.work?.workMin !== 0) continue;
    workByDate.set(r.date, (workByDate.get(r.date) ?? 0) + r.work.workMin);
  }
  const workSeries = Array.from(workByDate.entries())
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const allPlans = records.flatMap((r) => (r.plans ?? []).map((p) => ({ date: r.date, ...p })));

  const planTokens = new Map();
  for (const p of allPlans) {
    for (const tok of tokenizeJP(p.text)) {
      if (tok.length <= 1) continue;
      planTokens.set(tok, (planTokens.get(tok) ?? 0) + 1);
    }
  }
  const planKeywordRows = Array.from(planTokens.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 12);

  const issues = records.flatMap((r) => (r.issues ?? []).map((x) => ({ date: r.date, text: x })));

  const issueTokens = new Map();
  for (const it of issues) {
    for (const tok of tokenizeJP(it.text)) {
      if (tok.length <= 1) continue;
      issueTokens.set(tok, (issueTokens.get(tok) ?? 0) + 1);
    }
  }
  const issueKeywordRows = Array.from(issueTokens.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 12);

  return {
    records,
    allTasks,
    taskCountRows,
    statusRows,
    workSeries,
    allPlans,
    planKeywordRows,
    issues,
    issueKeywordRows,
  };
}

function renderKpis(agg) {
  const el = $("#kpis");
  if (!el) return;
  const dayCount = agg.records.length;
  const taskCount = agg.allTasks.length;
  const uniqueTasks = new Set(agg.allTasks.map((t) => t.name)).size;
  const workTotal = agg.workSeries.reduce((sum, x) => sum + x.minutes, 0);

  el.innerHTML = [
    kpi("解析日数", String(dayCount), "日付不明も含む"),
    kpi("タスク件数", String(taskCount), "抽出できたタスク数"),
    kpi("ユニークタスク", String(uniqueTasks), "タスク名の種類数"),
    kpi("稼働合計", formatMinutes(workTotal), agg.workSeries.length ? `${agg.workSeries.length}日分` : "稼働が取れた日だけ計算"),
  ].join("");
}

function kpi(label, value, hint) {
  return `<div class="kpi"><div class="kpi__label">${escapeHtml(label)}</div><div class="kpi__value">${escapeHtml(value)}</div><div class="kpi__hint">${escapeHtml(hint)}</div></div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderBarChart(container, rows, valueKey, labelKey, maxRows = 12) {
  const el = typeof container === "string" ? $(container) : container;
  if (!el) return;
  const top = rows.slice(0, maxRows);
  const max = Math.max(1, ...top.map((r) => r[valueKey] ?? 0));
  const html = top
    .map((r) => {
      const value = r[valueKey] ?? 0;
      const pct = clamp((value / max) * 100, 0, 100);
      const label = r[labelKey] ?? "";
      return `
        <div class="barRow">
          <div>
            <div class="barRow__label"><span>${escapeHtml(label)}</span><small>${escapeHtml(String(value))}</small></div>
            <div class="barTrack"><div class="barFill" style="width:${pct.toFixed(2)}%"></div></div>
          </div>
          <div class="barValue">${escapeHtml(String(value))}</div>
        </div>
      `;
    })
    .join("");

  el.innerHTML = `<div class="barList">${html || `<div class="muted">データがありません</div>`}</div>`;
}

function renderStatusChart(agg) {
  const mapLabel = {
    done: "完了",
    waiting_review: "レビュー待ち",
    ongoing: "継続",
    percent: "%",
    other: "その他",
  };
  const rows = agg.statusRows
    .map((r) => ({ name: mapLabel[r.key] ?? r.key, count: r.count }))
    .sort((a, b) => b.count - a.count);
  renderBarChart("#chartStatus", rows, "count", "name", 10);
}

function renderWorkTime(agg) {
  const el = $("#chartWorkTime");
  const sumEl = $("#workTimeSummary");
  if (!el || !sumEl) return;

  const series = agg.workSeries;
  const total = series.reduce((s, x) => s + x.minutes, 0);
  if (!series.length) {
    sumEl.textContent = "稼働が抽出できた日がありません。";
    el.innerHTML = `<div class="muted">稼働が抽出できた日がありません</div>`;
    return;
  }
  sumEl.textContent = `稼働合計: ${formatMinutes(total)}（${series.length}日分）`;

  const w = 640;
  const h = 180;
  const pad = 28;
  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.minutes);
  const yMax = Math.max(...ys, 1);
  const xScale = (x) => pad + (x / Math.max(1, xs.length - 1)) * (w - pad * 2);
  const yScale = (y) => (h - pad) - (y / yMax) * (h - pad * 2);
  const points = series.map((p, i) => `${xScale(i).toFixed(2)},${yScale(p.minutes).toFixed(2)}`).join(" ");

  const last = series[series.length - 1];
  const labels = series
    .map((p, i) => (i === 0 || i === series.length - 1 ? `<text x="${xScale(i)}" y="${h - 8}" fill="rgba(255,255,255,.55)" font-size="11" text-anchor="${i === 0 ? "start" : "end"}">${escapeHtml(p.date)}</text>` : ""))
    .join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="稼働時間推移">
      <polyline fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1" points="${pad},${h - pad} ${w - pad},${h - pad}"></polyline>
      <polyline fill="none" stroke="rgba(124,156,255,.9)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${points}"></polyline>
      ${series
        .map((p, i) => `<circle cx="${xScale(i)}" cy="${yScale(p.minutes)}" r="3.2" fill="rgba(105,240,174,.9)"></circle>`)
        .join("")}
      <text x="${pad}" y="${pad - 6}" fill="rgba(255,255,255,.65)" font-size="12">${escapeHtml(formatMinutes(yMax))}</text>
      <text x="${w - pad}" y="${pad - 6}" fill="rgba(255,255,255,.65)" font-size="12" text-anchor="end">${escapeHtml(formatMinutes(last.minutes))}（最新）</text>
      ${labels}
    </svg>
  `;
}

function renderPlans(agg) {
  const listEl = $("#listPlans");
  const keyEl = $("#planKeywords");
  if (!listEl || !keyEl) return;

  const rows = agg.planKeywordRows;
  keyEl.innerHTML = rows.length
    ? `<div class="pillRow">${rows.map((r) => `<span class="pill"><strong>${escapeHtml(r.token)}</strong> × ${escapeHtml(String(r.count))}</span>`).join("")}</div>`
    : "キーワードは抽出できませんでした。";

  const byDate = groupBy(agg.allPlans, (p) => p.date ?? "（日付不明）");
  const dates = Array.from(byDate.keys()).sort(sortDateKey);
  const blocks = dates.map((d) => {
    const items = byDate.get(d) ?? [];
    const li = items
      .map((p) => `<li><strong>${escapeHtml(p.priority)}</strong> ${escapeHtml(p.text)}</li>`)
      .join("");
    return `<div class="dayBlock"><div class="dayBlock__header"><div class="dayBlock__date">${escapeHtml(d)}</div><div class="dayBlock__meta">${escapeHtml(String(items.length))}件</div></div><ul class="taskList">${li}</ul></div>`;
  });

  listEl.innerHTML = blocks.join("") || `<div class="muted">予定が見つかりませんでした</div>`;
}

function renderIssues(agg) {
  const listEl = $("#listIssues");
  const keyEl = $("#issueKeywords");
  if (!listEl || !keyEl) return;

  const rows = agg.issueKeywordRows ?? [];
  keyEl.innerHTML = rows.length
    ? `<div class="pillRow">${rows.map((r) => `<span class="pill"><strong>${escapeHtml(r.token)}</strong> × ${escapeHtml(String(r.count))}</span>`).join("")}</div>`
    : "キーワードは抽出できませんでした。";

  const byDate = groupBy(agg.issues ?? [], (p) => p.date ?? "（日付不明）");
  const dates = Array.from(byDate.keys()).sort(sortDateKey);
  const blocks = dates.map((d) => {
    const items = byDate.get(d) ?? [];
    const li = items.map((p) => `<li>${escapeHtml(p.text)}</li>`).join("");
    return `<div class="dayBlock"><div class="dayBlock__header"><div class="dayBlock__date">${escapeHtml(d)}</div><div class="dayBlock__meta">${escapeHtml(String(items.length))}件</div></div><ul class="taskList">${li}</ul></div>`;
  });

  listEl.innerHTML = blocks.join("") || `<div class="muted">課題が見つかりませんでした</div>`;
}

function renderTimeline(agg) {
  const el = $("#timeline");
  if (!el) return;

  const byDate = groupBy(agg.records, (r) => r.date ?? "（日付不明）");
  const dates = Array.from(byDate.keys()).sort(sortDateKey);

  const blocks = dates.map((dateKey) => {
    const days = byDate.get(dateKey) ?? [];
    // Merge same-day tasks from multiple sources
    const tasks = days.flatMap((d) => d.tasks.map((t) => ({ ...t, sourceName: d.sourceName })));
    const issues = days.flatMap((d) => d.issues ?? []);
    const work = days.map((d) => d.work?.workMin).find((x) => x != null);

    const taskLis = tasks
      .map((t) => {
        const sub = [];
        if (t.progress?.raw) sub.push(`進捗: ${t.progress.raw}`);
        if (t.output) sub.push(`成果: ${t.output}`);
        const subHtml = sub.length ? `<div class="sub">${escapeHtml(sub.join(" / "))}</div>` : "";
        return `<li>${escapeHtml(t.name)}${subHtml}</li>`;
      })
      .join("");

    const issueHtml = issues.length
      ? `<div class="muted" style="margin-top:8px;">課題: ${escapeHtml(issues.join(" / "))}</div>`
      : "";

    const meta = [
      tasks.length ? `${tasks.length}タスク` : null,
      work != null ? `稼働 ${formatMinutes(work)}` : null,
    ]
      .filter(Boolean)
      .join(" / ");

    return `
      <div class="dayBlock">
        <div class="dayBlock__header">
          <div class="dayBlock__date">${escapeHtml(dateKey)}</div>
          <div class="dayBlock__meta">${escapeHtml(meta || "—")}</div>
        </div>
        ${tasks.length ? `<ul class="taskList">${taskLis}</ul>` : `<div class="muted">タスクなし</div>`}
        ${issueHtml}
      </div>
    `;
  });

  el.innerHTML = blocks.join("") || `<div class="muted">データがありません</div>`;
}

function renderWarnings(warnings) {
  const box = $("#parseWarnings");
  const list = $("#warningsList");
  if (!box || !list) return;
  if (!warnings.length) {
    box.hidden = true;
    list.innerHTML = "";
    return;
  }
  box.hidden = false;
  list.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

function collectFiltersFromUI() {
  return {
    from: $("#filterFrom")?.value || "",
    to: $("#filterTo")?.value || "",
    status: $("#filterStatus")?.value || "",
    query: $("#filterQuery")?.value || "",
    hideUnknownDate: $("#filterHideUnknownDate")?.checked || false,
  };
}

function renderAll(agg) {
  renderKpis(agg);
  renderBarChart("#chartTaskCount", agg.taskCountRows, "count", "name", 12);
  renderStatusChart(agg);
  renderWorkTime(agg);
  renderPlans(agg);
  renderIssues(agg);
  renderTimeline(agg);
}

let current = {
  rawRecords: [],
  agg: null,
  lastInputSummary: "",
};

async function readFilesAsText(files) {
  const results = [];
  for (const f of files) {
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(f);
    });
    results.push({ name: f.name, text });
  }
  return results;
}

function setEnabledAfterAnalysis(enabled) {
  $("#btnDownloadJson").disabled = !enabled;
  $("#btnClear").disabled = !enabled;
  $("#filtersPanel").hidden = !enabled;
  $("#resultsPanel").hidden = !enabled;
}

function initFilterListeners() {
  const rerender = () => {
    if (!current.agg) return;
    const filters = collectFiltersFromUI();
    const filtered = applyFilters(current.rawRecords, filters);
    const agg2 = aggregate(filtered);
    current.agg = agg2;
    renderAll(agg2);
  };
  ["#filterFrom", "#filterTo", "#filterStatus", "#filterQuery", "#filterHideUnknownDate"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", rerender);
    el.addEventListener("change", rerender);
  });
}

function setDateFilterBounds(records) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  const fromEl = $("#filterFrom");
  const toEl = $("#filterTo");
  if (!fromEl || !toEl) return;

  if (!dates.length) {
    fromEl.value = "";
    toEl.value = "";
    return;
  }
  fromEl.min = dates[0];
  fromEl.max = dates[dates.length - 1];
  toEl.min = dates[0];
  toEl.max = dates[dates.length - 1];
  if (!fromEl.value) fromEl.value = dates[0];
  if (!toEl.value) toEl.value = dates[dates.length - 1];
}

function clearAll() {
  current = { rawRecords: [], agg: null, lastInputSummary: "" };
  $("#fileInput").value = "";
  $("#pasteInput").value = "";
  $("#inputSummary").textContent = "";
  renderWarnings([]);
  setEnabledAfterAnalysis(false);
}

async function analyzeFromUI() {
  const fileInput = $("#fileInput");
  const pasteInput = $("#pasteInput");
  const files = Array.from(fileInput?.files ?? []);
  const pasted = safeTrim(pasteInput?.value ?? "");

  const inputs = [];
  if (files.length) {
    const fileTexts = await readFilesAsText(files);
    inputs.push(...fileTexts.map((x) => ({ sourceName: x.name, text: x.text })));
  }
  if (pasted) inputs.push({ sourceName: "貼り付け", text: pasted });

  if (!inputs.length) {
    alert("ファイル選択または貼り付けをしてください。");
    return;
  }

  const records = [];
  const warnings = [];
  for (const inp of inputs) {
    const days = parseAny(inp.text, inp.sourceName);
    for (const d of days) {
      records.push(d);
      warnings.push(...(d.warnings ?? []).map((w) => `${inp.sourceName}: ${w}`));
    }
  }

  // Sort by date
  records.sort((a, b) => sortDateKey(a.date, b.date));

  current.rawRecords = records;
  setDateFilterBounds(records);

  const filtered = applyFilters(records, collectFiltersFromUI());
  const agg = aggregate(filtered);
  current.agg = agg;

  $("#inputSummary").textContent = `${inputs.length}入力 / ${records.length}日分（分割含む） / ${agg.allTasks.length}タスク`;
  renderWarnings(warnings.slice(0, 30));
  setEnabledAfterAnalysis(true);
  renderAll(agg);
}

function init() {
  $("#btnAnalyze")?.addEventListener("click", () => {
    analyzeFromUI().catch((e) => {
      console.error(e);
      alert(`解析中にエラーが発生しました: ${e?.message ?? e}`);
    });
  });
  $("#btnDownloadJson")?.addEventListener("click", () => {
    if (!current.agg) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      records: current.rawRecords,
      aggregated: {
        taskCountRows: current.agg.taskCountRows,
        statusRows: current.agg.statusRows,
        workSeries: current.agg.workSeries,
        planKeywordRows: current.agg.planKeywordRows,
      },
    };
    downloadText(`daily-report-analysis_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  });
  $("#btnClear")?.addEventListener("click", clearAll);
  initFilterListeners();
  setEnabledAfterAnalysis(false);
}

init();

// Expose for quick debugging in DevTools.
window.DailyReportAnalyzer = {
  parseAny,
  parseTemplateStyleDaily,
  parseRawBulletText,
  aggregate,
  applyFilters,
  statusNormalize,
};

