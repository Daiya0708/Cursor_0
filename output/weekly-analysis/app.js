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

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  const t = safeTrim(s)
    .replace(/[()\[\]{}「」『』【】]/g, " ")
    .replace(/[。、・，,.!！?？:：;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  return t.split(" ").filter(Boolean);
}

function parseIsoDateLoose(s) {
  const t = safeTrim(s);
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

function inferWeekFromFilename(name) {
  const n = safeTrim(name);
  const m = n.match(/(\d{4}|\d{2}xx|\d{2}XX)(\d{2})(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`.replace(/^(\d{2})xx/i, "$1XX");
  return { weekStart: iso, weekEnd: null };
}

function parseFrontmatter(text) {
  const t = normalizeNewlines(text);
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return { frontmatter: {}, body: t };
  const raw = fm[1];
  const body = t.slice(fm[0].length);
  const frontmatter = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = safeTrim(m[2]);
    frontmatter[k] = v;
  }
  return { frontmatter, body };
}

function parseWeekRange(weekValue) {
  const v = safeTrim(weekValue);
  if (!v) return { weekStart: null, weekEnd: null };
  // "20XX-03-12 〜 20XX-03-19" / "~" / "-" etc.
  const m = v.match(/(\d{4}|\d{2}XX)\-\d{2}\-\d{2}[\s　]*[〜~\-–—→]+[\s　]*(\d{4}|\d{2}XX)\-\d{2}\-\d{2}/);
  if (!m) {
    const d = parseIsoDateLoose(v);
    return { weekStart: d, weekEnd: null };
  }
  const left = parseIsoDateLoose(v);
  const rightMatch = v.match(/([0-9X]{2,4}\-\d{2}\-\d{2})\s*$/);
  const right = rightMatch ? parseIsoDateLoose(rightMatch[1]) : null;
  return { weekStart: left, weekEnd: right };
}

function sectionKeyFromHeader(line) {
  if (/^##\s*2\./.test(line) && line.includes("実績")) return "done";
  if (/^##\s*3\./.test(line) && (line.includes("進行中") || line.includes("Doing"))) return "doing";
  if (/^##\s*4\./.test(line) && (line.includes("来週") || line.includes("Plan"))) return "plan";
  if (/^##\s*5\./.test(line) && (line.includes("課題") || line.includes("Issues") || line.includes("リスク"))) return "issues";
  if (/^##\s*6\./.test(line) || /^##\s*7\./.test(line) || /^##\s*8\./.test(line) || /^##\s*9\./.test(line)) return "other";
  return null;
}

function parseWeeklyReport(text, sourceName = "") {
  const t = normalizeNewlines(text);
  const { frontmatter, body } = parseFrontmatter(t);

  const warnings = [];
  let { weekStart, weekEnd } = parseWeekRange(frontmatter.week);
  if (!weekStart) {
    const inf = inferWeekFromFilename(sourceName);
    if (inf?.weekStart) weekStart = inf.weekStart;
  }
  if (!weekStart) warnings.push(`週範囲が抽出できませんでした（frontmatter.week が必要かもしれません / source=${sourceName || "貼り付け"}）。`);

  const lines = body.split("\n");
  let section = null; // done/doing/plan/issues/other
  let sub = null; // for plan: top/other ; for done: major/other

  const doneMajor = [];
  const doneOther = [];
  const doing = [];
  const planTop = [];
  const planOther = [];
  const issues = [];
  const otherNotes = [];

  const isBullet = (l) => /^\s*-\s+/.test(l) || /^\s*\d+\.\s+/.test(l);

  for (let i = 0; i < lines.length; i++) {
    const lineRaw = lines[i];
    const line = lineRaw;

    const sk = sectionKeyFromHeader(line);
    if (sk) {
      section = sk;
      sub = null;
      continue;
    }

    if (section === "done") {
      if (/^###\s*2-1\./.test(line) && line.includes("主要成果")) sub = "major";
      if (/^###\s*2-2\./.test(line) && line.includes("その他")) sub = "other";

      const majorM = line.match(/^\-\s*\*\*成果\/タスク\*\*\s*:\s*(.+)$/);
      if (majorM) {
        const item = { title: safeTrim(majorM[1]), purpose: "", result: "", evidence: "" };
        for (let j = i + 1; j < lines.length; j++) {
          const l2 = lines[j];
          if (/^\-\s*\*\*成果\/タスク\*\*/.test(l2) || /^##\s+/.test(l2) || /^###\s+/.test(l2)) {
            i = j - 1;
            break;
          }
          const p = l2.match(/^\s*\-\s*\*\*背景\/目的\*\*\s*:\s*(.+)$/);
          const r = l2.match(/^\s*\-\s*\*\*結果\*\*\s*:\s*(.+)$/);
          const e = l2.match(/^\s*\-\s*\*\*補足（数値\/リンク\/証跡）\*\*\s*:\s*(.+)$/);
          if (p) item.purpose = safeTrim(p[1]);
          if (r) item.result = safeTrim(r[1]);
          if (e) item.evidence = safeTrim(e[1]);
        }
        doneMajor.push(item);
        continue;
      }

      if (sub === "other" && isBullet(line)) {
        const txt = safeTrim(line.replace(/^\s*-\s+/, ""));
        if (txt) doneOther.push(txt);
      }
    } else if (section === "doing") {
      const m = line.match(/^\-\s*\*\*テーマ\/案件名\*\*\s*:\s*(.+)$/);
      if (m) {
        const item = { title: safeTrim(m[1]), current: "", next: "", eta: "" };
        for (let j = i + 1; j < lines.length; j++) {
          const l2 = lines[j];
          if (/^\-\s*\*\*テーマ\/案件名\*\*/.test(l2) || /^##\s+/.test(l2)) {
            i = j - 1;
            break;
          }
          const c = l2.match(/^\s*\-\s*\*\*現状\*\*\s*:\s*(.+)$/);
          const n = l2.match(/^\s*\-\s*\*\*次の一手\*\*\s*:\s*(.+)$/);
          const e = l2.match(/^\s*\-\s*\*\*完了見込み\*\*\s*:\s*(.+)$/);
          if (c) item.current = safeTrim(c[1]);
          if (n) item.next = safeTrim(n[1]);
          if (e) item.eta = safeTrim(e[1]);
        }
        doing.push(item);
      }
    } else if (section === "plan") {
      if (/^###\s*4-1\./.test(line) && line.includes("トップ3")) sub = "top";
      if (/^###\s*4-2\./.test(line)) sub = "other";

      if (sub === "top") {
        const m = line.match(/^\s*\d+\.\s*(.+)$/);
        if (m) planTop.push(safeTrim(m[1]));
      } else if (sub === "other") {
        if (/^\s*-\s+/.test(line)) {
          const txt = safeTrim(line.replace(/^\s*-\s+/, ""));
          if (txt) planOther.push(txt);
        }
      }
    } else if (section === "issues") {
      const m = line.match(/^\-\s*\*\*事象\*\*\s*:\s*(.+)$/);
      if (m) {
        const item = { incident: safeTrim(m[1]), impact: "", cause: "", action: "", ask: "", due: "" };
        for (let j = i + 1; j < lines.length; j++) {
          const l2 = lines[j];
          if (/^\-\s*\*\*事象\*\*/.test(l2) || /^##\s+/.test(l2)) {
            i = j - 1;
            break;
          }
          const impact = l2.match(/^\s*\-\s*\*\*影響\*\*\s*:\s*(.+)$/);
          const cause = l2.match(/^\s*\-\s*\*\*原因仮説\*\*\s*:\s*(.+)$/);
          const action = l2.match(/^\s*\-\s*\*\*対処案\*\*\s*:\s*(.+)$/);
          const ask = l2.match(/^\s*\-\s*\*\*相談したい相手\/必要な意思決定\*\*\s*:\s*(.+)$/);
          const due = l2.match(/^\s*\-\s*\*\*期限\*\*\s*:\s*(.+)$/);
          if (impact) item.impact = safeTrim(impact[1]);
          if (cause) item.cause = safeTrim(cause[1]);
          if (action) item.action = safeTrim(action[1]);
          if (ask) item.ask = safeTrim(ask[1]);
          if (due) item.due = safeTrim(due[1]);
        }
        issues.push(item);
      }
    } else if (section === "other") {
      if (isBullet(line)) {
        const txt = safeTrim(line.replace(/^\s*(?:-|\d+\.)\s+/, ""));
        if (txt) otherNotes.push(txt);
      }
    }
  }

  if (!doneMajor.length && !doneOther.length && !doing.length && !planTop.length && !planOther.length && !issues.length) {
    warnings.push("主要セクションからアイテムを抽出できませんでした（見出しや記法が異なる可能性）。");
  }

  return {
    kind: "weekly",
    sourceName: sourceName || "貼り付け",
    frontmatter,
    weekStart,
    weekEnd,
    doneMajor,
    doneOther,
    doing,
    planTop,
    planOther,
    issues,
    otherNotes,
    warnings,
    raw: t,
  };
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
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function applyFilters(records, filters) {
  const from = filters.from || null;
  const to = filters.to || null;
  const kind = filters.kind || "";
  const q = safeTrim(filters.query).toLowerCase();
  const hideUnknownWeek = !!filters.hideUnknownWeek;

  const out = [];
  for (const r of records) {
    if (hideUnknownWeek && !r.weekStart) continue;
    if (from && r.weekStart && r.weekStart < from) continue;
    if (to && r.weekStart && r.weekStart > to) continue;

    if (!kind && !q) {
      out.push(r);
      continue;
    }

    const matchText = (txt) => (q ? safeTrim(txt).toLowerCase().includes(q) : true);

    const hasAnyKind = (k) => {
      if (k === "done") return r.doneMajor.some((x) => matchText(x.title) || matchText(x.purpose) || matchText(x.result) || matchText(x.evidence)) || r.doneOther.some(matchText);
      if (k === "doing") return r.doing.some((x) => matchText(x.title) || matchText(x.current) || matchText(x.next) || matchText(x.eta));
      if (k === "plan") return r.planTop.some(matchText) || r.planOther.some(matchText);
      if (k === "issues") return r.issues.some((x) => matchText(x.incident) || matchText(x.impact) || matchText(x.cause) || matchText(x.action) || matchText(x.ask) || matchText(x.due));
      if (k === "other") return r.otherNotes.some(matchText);
      return true;
    };

    if (kind) {
      if (hasAnyKind(kind)) out.push(r);
      continue;
    }

    // kind unspecified but query exists
    const any =
      hasAnyKind("done") ||
      hasAnyKind("doing") ||
      hasAnyKind("plan") ||
      hasAnyKind("issues") ||
      hasAnyKind("other");
    if (any) out.push(r);
  }
  return out;
}

function aggregate(records) {
  const doneItems = records.flatMap((r) => r.doneMajor.map((x) => ({ weekStart: r.weekStart, weekEnd: r.weekEnd, sourceName: r.sourceName, ...x })));
  const doingItems = records.flatMap((r) => r.doing.map((x) => ({ weekStart: r.weekStart, weekEnd: r.weekEnd, sourceName: r.sourceName, ...x })));
  const planItems = records.flatMap((r) => [
    ...r.planTop.map((t) => ({ weekStart: r.weekStart, bucket: "top", text: t, sourceName: r.sourceName })),
    ...r.planOther.map((t) => ({ weekStart: r.weekStart, bucket: "other", text: t, sourceName: r.sourceName })),
  ]);
  const issueItems = records.flatMap((r) => r.issues.map((x) => ({ weekStart: r.weekStart, sourceName: r.sourceName, ...x })));
  const otherItems = records.flatMap((r) => r.otherNotes.map((t) => ({ weekStart: r.weekStart, text: t, sourceName: r.sourceName })));

  const countByTitle = (items, keyFn) => {
    const map = new Map();
    for (const it of items) {
      const k = safeTrim(keyFn(it)) || "（無題）";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  const doneCountRows = countByTitle(doneItems, (x) => x.title);
  const doingCountRows = countByTitle(doingItems, (x) => x.title);

  const planSplit = [
    { name: "トップ3", count: planItems.filter((x) => x.bucket === "top").length },
    { name: "それ以外", count: planItems.filter((x) => x.bucket === "other").length },
  ];

  const kindRows = [
    { name: "Done", count: doneItems.length + records.reduce((s, r) => s + r.doneOther.length, 0) },
    { name: "Doing", count: doingItems.length },
    { name: "Plan", count: planItems.length },
    { name: "Issues", count: issueItems.length },
    { name: "Other", count: otherItems.length },
  ];

  const planTokens = new Map();
  for (const p of planItems) {
    for (const tok of tokenizeJP(p.text)) {
      if (tok.length <= 1) continue;
      if (["の", "こと", "ため", "まで", "から", "する", "して", "した", "します"].includes(tok)) continue;
      planTokens.set(tok, (planTokens.get(tok) ?? 0) + 1);
    }
  }
  const planKeywordRows = Array.from(planTokens.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 12);

  const issueTokens = new Map();
  for (const it of issueItems) {
    const blob = [it.incident, it.impact, it.cause, it.action, it.ask].filter(Boolean).join(" ");
    for (const tok of tokenizeJP(blob)) {
      if (tok.length <= 1) continue;
      if (["の", "こと", "ため", "まで", "から", "する", "して", "した", "可能性"].includes(tok)) continue;
      issueTokens.set(tok, (issueTokens.get(tok) ?? 0) + 1);
    }
  }
  const issueKeywordRows = Array.from(issueTokens.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 12);

  return {
    records,
    doneItems,
    doingItems,
    planItems,
    issueItems,
    otherItems,
    doneCountRows,
    doingCountRows,
    planSplit,
    kindRows,
    planKeywordRows,
    issueKeywordRows,
  };
}

function kpi(label, value, hint) {
  return `<div class="kpi"><div class="kpi__label">${escapeHtml(label)}</div><div class="kpi__value">${escapeHtml(value)}</div><div class="kpi__hint">${escapeHtml(hint)}</div></div>`;
}

function renderKpis(agg) {
  const el = $("#kpis");
  if (!el) return;
  const weekCount = agg.records.length;
  const doneCount = agg.kindRows.find((x) => x.name === "Done")?.count ?? 0;
  const doingCount = agg.kindRows.find((x) => x.name === "Doing")?.count ?? 0;
  const planCount = agg.kindRows.find((x) => x.name === "Plan")?.count ?? 0;
  const issueCount = agg.kindRows.find((x) => x.name === "Issues")?.count ?? 0;

  el.innerHTML = [
    kpi("解析週数", String(weekCount), "週不明も含む"),
    kpi("Done", String(doneCount), "成果/タスク + その他"),
    kpi("Doing", String(doingCount), "進行中のテーマ/案件"),
    kpi("Plan/Issues", `${planCount}/${issueCount}`, "来週予定 / 課題・リスク"),
  ].join("");
}

function renderBarChart(containerSel, rows, valueKey, labelKey, maxRows = 12) {
  const el = typeof containerSel === "string" ? $(containerSel) : containerSel;
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

function renderPills(containerSel, rows) {
  const el = $(containerSel);
  if (!el) return;
  el.innerHTML = rows.length
    ? `<div class="pillRow">${rows.map((r) => `<span class="pill"><strong>${escapeHtml(r.token)}</strong> × ${escapeHtml(String(r.count))}</span>`).join("")}</div>`
    : "キーワードは抽出できませんでした。";
}

function renderPlans(agg) {
  renderPills("#planKeywords", agg.planKeywordRows ?? []);
  const listEl = $("#listPlans");
  if (!listEl) return;
  const byWeek = groupBy(agg.planItems ?? [], (p) => p.weekStart ?? "（週不明）");
  const weeks = Array.from(byWeek.keys()).sort(sortDateKey);
  const blocks = weeks.map((wk) => {
    const items = (byWeek.get(wk) ?? []).slice();
    const top = items.filter((x) => x.bucket === "top");
    const other = items.filter((x) => x.bucket === "other");
    const liTop = top.map((p) => `<li><strong>Top</strong> ${escapeHtml(p.text)}</li>`).join("");
    const liOther = other.map((p) => `<li>${escapeHtml(p.text)}</li>`).join("");
    return `<div class="dayBlock">
      <div class="dayBlock__header">
        <div class="dayBlock__date">${escapeHtml(wk)}</div>
        <div class="dayBlock__meta">${escapeHtml(String(items.length))}件</div>
      </div>
      ${top.length ? `<div class="muted" style="margin-bottom:6px;">トップ3</div><ul class="taskList">${liTop}</ul>` : ""}
      ${other.length ? `<div class="muted" style="margin-top:10px;margin-bottom:6px;">それ以外</div><ul class="taskList">${liOther}</ul>` : ""}
    </div>`;
  });
  listEl.innerHTML = blocks.join("") || `<div class="muted">予定が見つかりませんでした</div>`;
}

function renderIssues(agg) {
  renderPills("#issueKeywords", agg.issueKeywordRows ?? []);
  const listEl = $("#listIssues");
  if (!listEl) return;
  const byWeek = groupBy(agg.issueItems ?? [], (p) => p.weekStart ?? "（週不明）");
  const weeks = Array.from(byWeek.keys()).sort(sortDateKey);
  const blocks = weeks.map((wk) => {
    const items = byWeek.get(wk) ?? [];
    const li = items
      .map((it) => {
        const sub = [];
        if (it.impact) sub.push(`影響: ${it.impact}`);
        if (it.action) sub.push(`対処: ${it.action}`);
        if (it.due) sub.push(`期限: ${it.due}`);
        const subHtml = sub.length ? `<div class="sub">${escapeHtml(sub.join(" / "))}</div>` : "";
        return `<li>${escapeHtml(it.incident)}${subHtml}</li>`;
      })
      .join("");
    return `<div class="dayBlock">
      <div class="dayBlock__header">
        <div class="dayBlock__date">${escapeHtml(wk)}</div>
        <div class="dayBlock__meta">${escapeHtml(String(items.length))}件</div>
      </div>
      ${items.length ? `<ul class="taskList">${li}</ul>` : `<div class="muted">課題なし</div>`}
    </div>`;
  });
  listEl.innerHTML = blocks.join("") || `<div class="muted">課題が見つかりませんでした</div>`;
}

function renderTimeline(agg) {
  const el = $("#timeline");
  if (!el) return;

  const byWeek = groupBy(agg.records ?? [], (r) => r.weekStart ?? "（週不明）");
  const weeks = Array.from(byWeek.keys()).sort(sortDateKey);
  const blocks = weeks.map((wk) => {
    const weeksRecs = byWeek.get(wk) ?? [];
    const merged = {
      doneMajor: weeksRecs.flatMap((r) => r.doneMajor),
      doneOther: weeksRecs.flatMap((r) => r.doneOther),
      doing: weeksRecs.flatMap((r) => r.doing),
      planTop: weeksRecs.flatMap((r) => r.planTop),
      planOther: weeksRecs.flatMap((r) => r.planOther),
      issues: weeksRecs.flatMap((r) => r.issues),
    };

    const meta = [
      merged.doneMajor.length + merged.doneOther.length ? `Done ${merged.doneMajor.length + merged.doneOther.length}` : null,
      merged.doing.length ? `Doing ${merged.doing.length}` : null,
      merged.planTop.length + merged.planOther.length ? `Plan ${merged.planTop.length + merged.planOther.length}` : null,
      merged.issues.length ? `Issues ${merged.issues.length}` : null,
    ]
      .filter(Boolean)
      .join(" / ");

    const doneLis = [
      ...merged.doneMajor.map((d) => {
        const sub = [];
        if (d.result) sub.push(`結果: ${d.result}`);
        if (d.evidence) sub.push(`証跡: ${d.evidence}`);
        const subHtml = sub.length ? `<div class="sub">${escapeHtml(sub.join(" / "))}</div>` : "";
        return `<li>${escapeHtml(d.title)}${subHtml}</li>`;
      }),
      ...merged.doneOther.map((t) => `<li>${escapeHtml(t)}</li>`),
    ].join("");

    const doingLis = merged.doing
      .map((d) => {
        const sub = [];
        if (d.next) sub.push(`次: ${d.next}`);
        if (d.eta) sub.push(`見込み: ${d.eta}`);
        const subHtml = sub.length ? `<div class="sub">${escapeHtml(sub.join(" / "))}</div>` : "";
        return `<li>${escapeHtml(d.title)}${subHtml}</li>`;
      })
      .join("");

    const planLis = [...merged.planTop.map((t) => `<li><strong>Top</strong> ${escapeHtml(t)}</li>`), ...merged.planOther.map((t) => `<li>${escapeHtml(t)}</li>`)].join("");

    const issueLis = merged.issues
      .map((x) => {
        const sub = [];
        if (x.impact) sub.push(`影響: ${x.impact}`);
        if (x.action) sub.push(`対処: ${x.action}`);
        const subHtml = sub.length ? `<div class="sub">${escapeHtml(sub.join(" / "))}</div>` : "";
        return `<li>${escapeHtml(x.incident)}${subHtml}</li>`;
      })
      .join("");

    return `
      <div class="dayBlock">
        <div class="dayBlock__header">
          <div class="dayBlock__date">${escapeHtml(wk)}</div>
          <div class="dayBlock__meta">${escapeHtml(meta || "—")}</div>
        </div>

        <div class="muted" style="margin:8px 0 6px;">Done</div>
        ${doneLis ? `<ul class="taskList">${doneLis}</ul>` : `<div class="muted">なし</div>`}

        <div class="muted" style="margin:10px 0 6px;">Doing</div>
        ${doingLis ? `<ul class="taskList">${doingLis}</ul>` : `<div class="muted">なし</div>`}

        <div class="muted" style="margin:10px 0 6px;">Plan</div>
        ${planLis ? `<ul class="taskList">${planLis}</ul>` : `<div class="muted">なし</div>`}

        <div class="muted" style="margin:10px 0 6px;">Issues</div>
        ${issueLis ? `<ul class="taskList">${issueLis}</ul>` : `<div class="muted">なし</div>`}
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

function setEnabledAfterAnalysis(enabled) {
  $("#btnDownloadJson").disabled = !enabled;
  $("#btnClear").disabled = !enabled;
  $("#filtersPanel").hidden = !enabled;
  $("#resultsPanel").hidden = !enabled;
}

function collectFiltersFromUI() {
  return {
    from: $("#filterFrom")?.value || "",
    to: $("#filterTo")?.value || "",
    kind: $("#filterKind")?.value || "",
    query: $("#filterQuery")?.value || "",
    hideUnknownWeek: $("#filterHideUnknownWeek")?.checked || false,
  };
}

function setWeekFilterBounds(records) {
  const weeks = records.map((r) => r.weekStart).filter(Boolean).sort();
  const fromEl = $("#filterFrom");
  const toEl = $("#filterTo");
  if (!fromEl || !toEl) return;
  if (!weeks.length) {
    fromEl.value = "";
    toEl.value = "";
    return;
  }
  fromEl.min = weeks[0];
  fromEl.max = weeks[weeks.length - 1];
  toEl.min = weeks[0];
  toEl.max = weeks[weeks.length - 1];
  if (!fromEl.value) fromEl.value = weeks[0];
  if (!toEl.value) toEl.value = weeks[weeks.length - 1];
}

function renderAll(agg) {
  renderKpis(agg);
  renderBarChart("#chartDoneCount", agg.doneCountRows ?? [], "count", "name", 12);
  renderBarChart("#chartDoingCount", agg.doingCountRows ?? [], "count", "name", 12);
  renderBarChart("#chartPlanSplit", agg.planSplit ?? [], "count", "name", 6);
  renderBarChart("#chartKind", agg.kindRows ?? [], "count", "name", 8);
  renderPlans(agg);
  renderIssues(agg);
  renderTimeline(agg);
}

let current = { rawRecords: [], agg: null };

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

function clearAll() {
  current = { rawRecords: [], agg: null };
  $("#fileInput").value = "";
  $("#pasteInput").value = "";
  $("#inputSummary").textContent = "";
  renderWarnings([]);
  setEnabledAfterAnalysis(false);
}

function initFilterListeners() {
  const rerender = () => {
    if (!current.agg) return;
    const filtered = applyFilters(current.rawRecords, collectFiltersFromUI());
    current.agg = aggregate(filtered);
    renderAll(current.agg);
  };
  ["#filterFrom", "#filterTo", "#filterKind", "#filterQuery", "#filterHideUnknownWeek"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", rerender);
    el.addEventListener("change", rerender);
  });
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
    const rec = parseWeeklyReport(inp.text, inp.sourceName);
    records.push(rec);
    warnings.push(...(rec.warnings ?? []).map((w) => `${inp.sourceName}: ${w}`));
  }

  records.sort((a, b) => sortDateKey(a.weekStart, b.weekStart));
  current.rawRecords = records;
  setWeekFilterBounds(records);

  const filtered = applyFilters(records, collectFiltersFromUI());
  current.agg = aggregate(filtered);

  const totalItems =
    current.agg.kindRows.reduce((s, x) => s + (x.count ?? 0), 0);

  $("#inputSummary").textContent = `${inputs.length}入力 / ${records.length}週 / ${totalItems}アイテム（概算）`;
  renderWarnings(warnings.slice(0, 30));
  setEnabledAfterAnalysis(true);
  renderAll(current.agg);
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
        doneCountRows: current.agg.doneCountRows,
        doingCountRows: current.agg.doingCountRows,
        planSplit: current.agg.planSplit,
        kindRows: current.agg.kindRows,
        planKeywordRows: current.agg.planKeywordRows,
        issueKeywordRows: current.agg.issueKeywordRows,
      },
    };
    downloadText(`weekly-report-analysis_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  });
  $("#btnClear")?.addEventListener("click", clearAll);
  initFilterListeners();
  setEnabledAfterAnalysis(false);
}

init();

// Expose for quick debugging in DevTools.
window.WeeklyReportAnalyzer = {
  parseWeeklyReport,
  aggregate,
  applyFilters,
};
