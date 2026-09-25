#!/usr/bin/env node
/* ============================================================
   内管責 過去問道場 — 問題データ変換スクリプト（依存なし）
   学習サイトの採点結果画面を保存したHTML（【N章】理解度チェック①.html /
   【習熟レベル】第①回.html）から、問題文・選択肢・正解・解説だけを取り出し、
   naikan/data/ch1.js〜ch8.js, level.js を生成する。
   受験時の解答番号・正誤判定・配点などの個人の受験結果は取り込まない。

   使い方:
     node naikan/tools/convert.js "<元HTMLフォルダ>"
   出力:
     naikan/data/ch1.js 〜 ch8.js, naikan/data/level.js
     naikan/tools/convert-report.md（ファイルごとの問数・形式別内訳・期待問数との突合）
   期待問数と一致しない、または検証エラーがある場合は終了コード1で終わる。
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = process.argv[2];
if (!SRC_DIR) {
  console.error('使い方: node naikan/tools/convert.js "<元HTMLフォルダ>"');
  process.exit(2);
}
const APP_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(APP_DIR, "data");
const REPORT = path.join(__dirname, "convert-report.md");

/* ---------- 分野定義・期待問数（要件書 3.2 / 3.3） ---------- */
const CHAPTERS = {
  1: { name: "第1章 内部管理・法令遵守態勢と役職員倫理", expect: [21, 13] },
  2: { name: "第2章 顧客口座の開設", expect: [16, 22, 21, 23] },
  3: { name: "第3章 投資勧誘の管理", expect: [27, 15, 22, 23, 20, 19, 22] },
  4: { name: "第4章 顧客注文の受託の管理", expect: [16, 14, 16] },
  5: { name: "第5章 受渡し・保管等の管理", expect: [18, 20, 23] },
  6: { name: "第6章 協会員と役職員の規制", expect: [21, 22, 22, 20, 22] },
  7: { name: "第7章 不公正取引の規制等", expect: [21, 21, 13] },
  8: { name: "第8章 その他内部管理に関する事項", expect: [26] },
};
const LEVEL = { name: "演習（習熟レベルチェックテスト）", short: "演習", expect: [50, 50, 50] };
const EXPECT_TOTAL = 709;

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const CIRCLED_OUT = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/* ---------- テキスト整形 ---------- */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");   // 最後に（二重デコード防止）
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

// 小問表（<table class="t10">）を「イ．本文」の行に展開する
function expandT10(html) {
  let out = "";
  let pos = 0;
  for (;;) {
    const t = html.indexOf("<table", pos);
    if (t < 0) { out += html.slice(pos); break; }
    const tagEnd = html.indexOf(">", t);
    const end = html.indexOf("</table>", tagEnd);
    if (tagEnd < 0 || end < 0) { out += html.slice(pos); break; }
    out += html.slice(pos, t);
    const inner = html.slice(tagEnd + 1, end);
    const rows = inner.split(/<tr[^>]*>/i).slice(1).map(tr => {
      const cells = tr.split(/<td[^>]*>/i).slice(1).map(td => stripTags(td.split(/<\/td>/i)[0]));
      return cells.map(c => c.replace(/[ \t\r\n]+/g, " ").trim()).join("");
    }).filter(Boolean);
    // 表の前に空行1つ（後段で連続改行を整理する）
    out += "\n\n" + rows.join("<br>") + "<br>";
    pos = end + "</table>".length;
  }
  return out;
}

function cleanHtml(html) {
  let s = html;
  s = s.replace(/[ \t\r\n]+/g, " ");          // ソース上の改行・インデントは空白扱い（全角スペースは保持）
  s = expandT10(s);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, " ");               // 連続空白（半角）を1つに
  s = s.split("\n").map(l => l.replace(/^[ \t]+|[ \t]+$/g, "")).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.replace(/^[\s]+|[\s]+$/g, "").replace(/^\n+|\n+$/g, "");
}

/* ---------- 1ファイルの解析 ---------- */
function parseFile(file) {
  const html = fs.readFileSync(file, "utf8");
  const titleM = html.match(/<title>([^<]*)<\/title>/);
  const title = titleM ? decodeEntities(titleM[1]).replace(/\s+/g, " ").trim() : "";

  const MARK = 'class="examComment">第';
  const parts = html.split(MARK).slice(1);
  const questions = [];
  const errors = [];

  parts.forEach((p, idx) => {
    const noM = p.match(/^\s*(\d+)\s*問/);
    const no = noM ? Number(noM[1]) : NaN;
    const where = `${path.basename(file)} 第${no}問`;
    if (no !== idx + 1) errors.push(`${where}: 問番号の並びが不正（${idx + 1}番目）`);

    // 問題文
    const qs = p.indexOf('class="examQuestion"');
    const qStart = p.indexOf(">", qs) + 1;
    const ansTbl = p.indexOf('<table class="examAnswer"');
    if (qs < 0 || ansTbl < 0) { errors.push(`${where}: 問題文/選択肢が見つからない`); return; }
    // examQuestion の </td> は小問表の </td> と区別が必要なので、選択肢表の手前で区切る
    let qHtml = p.slice(qStart, ansTbl);
    const lastTd = qHtml.lastIndexOf("</td>");
    if (lastTd >= 0) qHtml = qHtml.slice(0, lastTd);
    const q = cleanHtml(qHtml);

    // 選択肢
    const ansEnd = p.indexOf("</table>", ansTbl);
    const ansHtml = p.slice(ansTbl, ansEnd);
    const rows = ansHtml.split(/<tr[^>]*>/i).slice(1);
    const choices = [];
    let correct = [];
    rows.forEach(tr => {
      const tds = tr.split(/<td[^>]*>/i).slice(1).map(td => td.split(/<\/td>/i)[0]);
      if (tds.length < 2) return;
      let body = tds[1];
      const isCorrect = body.indexOf("（正解）") >= 0;
      body = body.replace(/<span class="font_result">[\s\S]*?<\/span>/g, "");
      if (isCorrect) correct.push(choices.length);
      choices.push(cleanHtml(body));
    });

    // 解説（status_explanation.gif の直後から、その div の終わりまで）
    let exp = "";
    const ex = p.indexOf("status_explanation.gif", ansEnd);
    if (ex < 0) errors.push(`${where}: 解説が見つからない`);
    else {
      const exStart = p.indexOf(">", ex) + 1;
      const exEnd = p.indexOf("</div>", exStart);
      let eHtml = p.slice(exStart, exEnd);
      eHtml = eHtml.replace(/<a\b[^>]*>\s*(PDFテキスト|復習)\s*<\/a>/g, "");
      exp = cleanHtml(eHtml);
    }

    if (correct.length !== 1) errors.push(`${where}: 正解数が ${correct.length}`);
    if (choices.length < 2 || choices.length > 5) errors.push(`${where}: 選択肢数が ${choices.length}`);
    if (!q) errors.push(`${where}: 問題文が空`);
    if (!exp) errors.push(`${where}: 解説が空`);

    const a = correct[0];
    const norm = choices.map(c => c.replace(/〇/g, "○"));
    const isOxWords = norm.length === 2 && norm[0] === "正しい記述である" && norm[1] === "誤った記述である";
    const isOxMarks = norm.length === 2 && norm[0] === "○" && norm[1] === "×";
    if (isOxWords || isOxMarks) {
      questions.push({ t: "ox", q, a: a === 0, exp, _kind: isOxWords ? "ox-words" : "ox-marks" });
    } else {
      questions.push({ t: "mc", q, c: choices, a, exp, _kind: `mc${choices.length}` });
    }
  });
  return { title, questions, errors };
}

/* ---------- ファイル列挙 ---------- */
const files = fs.readdirSync(SRC_DIR).filter(f => /\.html$/i.test(f));
const entries = [];   // {file, kind:"ch"|"level", ch, round}
files.forEach(f => {
  let m = f.match(/^【(\d+)章】理解度チェック([①-⑩])\.html$/);
  if (m) { entries.push({ file: f, kind: "ch", ch: Number(m[1]), round: CIRCLED.indexOf(m[2]) + 1 }); return; }
  m = f.match(/^【習熟レベル】第([①-⑩])回\.html$/);
  if (m) { entries.push({ file: f, kind: "level", round: CIRCLED.indexOf(m[1]) + 1 }); return; }
  console.warn(`対象外のHTMLをスキップ: ${f}`);
});

/* ---------- 変換 ---------- */
const allErrors = [];
const reportRows = [];
const subjects = [];   // {subject, name, short, varName, units}

function buildUnits(list, expect, unitPrefix, unitNameFn, labelFn) {
  const units = [];
  expect.forEach((n, i) => {
    const round = i + 1;
    const e = list.find(x => x.round === round);
    if (!e) { allErrors.push(`${labelFn(round)}: 元ファイルが見つからない`); return; }
    const r = parseFile(path.join(SRC_DIR, e.file));
    r.errors.forEach(x => allErrors.push(x));
    const qs = r.questions;
    const cnt = k => qs.filter(q => q._kind === k).length;
    const ok = qs.length === n;
    if (!ok) allErrors.push(`${e.file}: 問数 ${qs.length}（期待 ${n}）`);
    reportRows.push({
      label: labelFn(round), file: e.file, title: r.title, n: qs.length, expect: n, ok,
      ox: cnt("ox-words") + cnt("ox-marks"), oxWords: cnt("ox-words"), oxMarks: cnt("ox-marks"),
      mc2: cnt("mc2"), mc3: cnt("mc3"), mc4: cnt("mc4"), mc5: cnt("mc5"),
    });
    units.push({ id: `${unitPrefix}${round}`, name: unitNameFn(round), questions: qs });
    e._title = r.title;
  });
  const extra = list.filter(x => x.round > expect.length);
  extra.forEach(x => allErrors.push(`${x.file}: 想定外の回（要件の単元表にない）`));
  return units;
}

Object.keys(CHAPTERS).map(Number).forEach(ch => {
  const def = CHAPTERS[ch];
  const list = entries.filter(e => e.kind === "ch" && e.ch === ch);
  const units = buildUnits(list, def.expect, "check",
    r => `理解度チェックテスト${CIRCLED_OUT[r - 1]}`,
    r => `${ch}章${CIRCLED_OUT[r - 1]}`);
  // <title> の章名と要件の章名を突合（全角数字・空白の差は無視）
  list.forEach(e => {
    if (!e._title) return;
    const m = e._title.match(/第(\d+)章\s+(.+?)\s+理解度チェックテスト/);
    const want = def.name.replace(/^第\d+章\s+/, "");
    if (!m || m[2] !== want) allErrors.push(`${e.file}: <title> の章名「${m ? m[2] : e._title}」が要件の「${want}」と不一致`);
  });
  subjects.push({ subject: `ch${ch}`, name: def.name, short: `${ch}章`, varName: `NAIKAN_CH${ch}`, units });
});
{
  const list = entries.filter(e => e.kind === "level");
  const units = buildUnits(list, LEVEL.expect, "round", r => `第${r}回`, r => `演習${CIRCLED_OUT[r - 1]}`);
  subjects.push({ subject: "level", name: LEVEL.name, short: LEVEL.short, varName: "NAIKAN_LEVEL", units });
}
entries.filter(e => e.kind === "ch" && !CHAPTERS[e.ch]).forEach(e => allErrors.push(`${e.file}: 想定外の章`));

/* ---------- 禁止文字列チェック ---------- */
const FORBIDDEN = ["<", ">", "&nbsp;", "（正解）", "xxxxxxxx", "（削除）", "PDFテキスト", "復習"];
subjects.forEach(s => s.units.forEach(u => u.questions.forEach((q, i) => {
  const texts = [q.q, q.exp, ...(q.c || [])];
  FORBIDDEN.forEach(f => {
    if (texts.some(t => t.includes(f))) allErrors.push(`${s.subject}/${u.id}/${i + 1}: 禁止文字列「${f}」を含む`);
  });
})));

/* ---------- 出力 ---------- */
function fmtQ(q) {
  const o = q.t === "ox" ? { t: "ox", q: q.q, a: q.a, exp: q.exp } : { t: "mc", q: q.q, c: q.c, a: q.a, exp: q.exp };
  return "      " + JSON.stringify(o) + ",";
}
fs.mkdirSync(OUT_DIR, { recursive: true });
subjects.forEach(s => {
  const lines = [];
  lines.push("/* ============================================================");
  lines.push(`   ${s.name} 問題データ（tools/convert.js で自動生成。手で編集しないこと）`);
  lines.push("   出典: 学習サイトのテスト結果画面（問題文・選択肢・正解・解説のみ抽出）");
  lines.push("   問題形式:");
  lines.push('     〇×     … { t:"ox", q:"問題文", a:true(〇)/false(×), exp:"解説" }');
  lines.push('     多肢選択 … { t:"mc", q:"問題文", c:["選択肢1",...], a:正解のindex(0始まり), exp:"解説" }');
  lines.push("   ※ 各単元の配列の並び順がそのまま問題番号・履歴IDになる");
  lines.push("   ============================================================ */");
  lines.push(`window.${s.varName} = {`);
  lines.push(`  subject: ${JSON.stringify(s.subject)},`);
  lines.push(`  name: ${JSON.stringify(s.name)},`);
  lines.push(`  short: ${JSON.stringify(s.short)},`);
  lines.push("  units: [");
  s.units.forEach(u => {
    lines.push(`    { id: ${JSON.stringify(u.id)}, name: ${JSON.stringify(u.name)}, questions: [`);
    u.questions.forEach(q => lines.push(fmtQ(q)));
    lines.push("    ] },");
  });
  lines.push("  ],");
  lines.push("};");
  lines.push("");
  fs.writeFileSync(path.join(OUT_DIR, `${s.subject}.js`), lines.join("\n"), "utf8");
});

/* ---------- レポート ---------- */
const total = reportRows.reduce((a, r) => a + r.n, 0);
const sum = k => reportRows.reduce((a, r) => a + r[k], 0);
const rep = [];
rep.push("# 変換レポート（convert.js）");
rep.push("");
rep.push(`- 実行日時: ${new Date().toISOString()}`);
rep.push(`- 元フォルダ: \`${SRC_DIR}\``);
rep.push(`- 対象HTML: ${entries.length} 本`);
rep.push(`- 合計: **${total} 問**（期待 ${EXPECT_TOTAL} 問）… ${total === EXPECT_TOTAL ? "一致" : "**不一致**"}`);
rep.push(`- 形式: ox ${sum("ox")}（正しい/誤った記述 ${sum("oxWords")}・○/× ${sum("oxMarks")}） / mc ${total - sum("ox")}（2択 ${sum("mc2")}・3択 ${sum("mc3")}・4択 ${sum("mc4")}・5択 ${sum("mc5")}）`);
rep.push(`- 検証エラー: ${allErrors.length} 件`);
rep.push("");
rep.push("## 単元ごとの問数");
rep.push("");
rep.push("| 単元 | 元ファイル | 問数 | 期待 | 判定 | ox | mc2 | mc3 | mc4 | mc5 |");
rep.push("|---|---|---:|---:|:-:|---:|---:|---:|---:|---:|");
reportRows.forEach(r => {
  rep.push(`| ${r.label} | ${r.file} | ${r.n} | ${r.expect} | ${r.ok ? "OK" : "NG"} | ${r.ox} | ${r.mc2} | ${r.mc3} | ${r.mc4} | ${r.mc5} |`);
});
rep.push(`| **合計** | | **${total}** | **${EXPECT_TOTAL}** | ${total === EXPECT_TOTAL ? "OK" : "NG"} | ${sum("ox")} | ${sum("mc2")} | ${sum("mc3")} | ${sum("mc4")} | ${sum("mc5")} |`);
rep.push("");
rep.push("## 分野ごとの合計");
rep.push("");
rep.push("| subject | name | 単元数 | 問数 |");
rep.push("|---|---|---:|---:|");
subjects.forEach(s => rep.push(`| ${s.subject} | ${s.name} | ${s.units.length} | ${s.units.reduce((a, u) => a + u.questions.length, 0)} |`));
rep.push("");
rep.push("## 検証エラー");
rep.push("");
if (allErrors.length === 0) rep.push("なし（全問: 正解1つ・選択肢2〜5・問題文/解説あり・禁止文字列なし）");
else allErrors.forEach(e => rep.push(`- ${e}`));
rep.push("");
fs.writeFileSync(REPORT, rep.join("\n"), "utf8");

console.log(`変換完了: ${total} 問（期待 ${EXPECT_TOTAL}）、エラー ${allErrors.length} 件`);
console.log(`レポート: ${REPORT}`);
if (allErrors.length) {
  allErrors.slice(0, 30).forEach(e => console.error("  - " + e));
  process.exit(1);
}
if (total !== EXPECT_TOTAL) process.exit(1);
