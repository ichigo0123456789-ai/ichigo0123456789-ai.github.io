/* ============================================================
   金財試験 過去問道場
   - 問題データは data/*.js が定義する KINZAI_ZAIMU / KINZAI_HOUMU /
     KINZAI_ZEIMU（subject → units → questions）を読む
   - 問題形式: t:"ox"（〇×） / t:"mc"（多肢選択, c:選択肢配列, a:正解index）
   - 解答履歴は localStorage("kinzai-dojo-v1") に保存
   ============================================================ */
(() => {
"use strict";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

/* ---------- 問題データの取り込み ---------- */
const SUBJECTS = [window.KINZAI_ZAIMU, window.KINZAI_HOUMU, window.KINZAI_ZEIMU].filter(Boolean);

// 全問題のフラットなリスト。id = "subject/unitId/連番"
const BANK = [];
SUBJECTS.forEach(s => {
  s.units.forEach(u => {
    u.key = `${s.subject}/${u.id}`;
    u.label = `【${s.name}】${u.name}`;
    u.subject = s.subject;
    u.subjectName = s.name;
    u.questions.forEach((item, i) => {
      const q = {
        id: `${u.key}/${i + 1}`,
        no: i + 1,
        subject: s.subject,
        subjectName: s.name,
        unit: u,
        t: item.t === "mc" ? "mc" : "ox",
        q: item.q,
        c: item.c || null,
        a: item.a,
        exp: item.exp || "（解説は準備中です）",
      };
      BANK.push(q);
      item._ref = q;
    });
  });
});

/* ---------- アカウント・履歴 (localStorage + サーバー同期) ---------- */
const SYNC_URL = String(window.KINZAI_SYNC_URL || "").trim();
const GUEST_KEY = "kinzai-dojo-v1";
const ACCOUNT_KEY = "kinzai-dojo-account";

let account = null;   // {id, pin} ログイン中のアカウント。null＝ゲスト（従来どおり端末内のみ）
try { account = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null"); } catch (e) { account = null; }
if (!account || !account.id || !account.pin || !SYNC_URL) account = null;

function lsKey() { return account ? `kinzai-dojo-user-${account.id}` : GUEST_KEY; }

function loadStoreRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object") return { hist: s.hist || {}, sel: s.sel || null };
    }
  } catch (e) { /* 破損時は初期化 */ }
  return { hist: {}, sel: null };
}
function loadStore() { return loadStoreRaw(lsKey()); }
function saveStoreLocal() {
  try { localStorage.setItem(lsKey(), JSON.stringify(store)); } catch (e) { /* 容量超過などは無視 */ }
}
function saveStore() {
  saveStoreLocal();
  scheduleSync();
}
let store = loadStore();

// 履歴のマージ：問題ごとに解答数(c+w)が多い側を採用、チェック(mark)はOR。
// 同じデータ同士なら結果が変わらないため、繰り返し実行しても安全
function mergeHist(a, b) {
  const out = {};
  new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach(k => {
    const x = (a || {})[k], y = (b || {})[k];
    if (!x || !y) {
      const p = x || y;
      out[k] = { c: p.c || 0, w: p.w || 0, last: p.last || null, mark: !!p.mark };
      return;
    }
    const p = ((y.c || 0) + (y.w || 0)) >= ((x.c || 0) + (x.w || 0)) ? y : x;
    out[k] = { c: p.c || 0, w: p.w || 0, last: p.last || null, mark: !!(x.mark || y.mark) };
  });
  return out;
}

/* ---------- サーバー同期 ---------- */
let syncTimer = null, syncBusy = false, syncDirty = false;

async function api(body) {
  const r = await fetch(SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },  // preflight回避のためtext/plain
    body: JSON.stringify(body),
  });
  return await r.json();
}

function setSyncStatus(text) {
  document.querySelectorAll(".sync-status").forEach(el => { el.textContent = text; });
}

function scheduleSync() {
  if (!account || !SYNC_URL) return;
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), 15000);
}

async function syncNow() {
  if (!account || !SYNC_URL || syncBusy) return;
  syncBusy = true;
  clearTimeout(syncTimer);
  try {
    const res = await api({ action: "sync", id: account.id, pin: account.pin, hist: store.hist });
    if (res.ok) {
      store.hist = mergeHist(store.hist, res.hist);
      saveStoreLocal();
      syncDirty = false;
      setSyncStatus(`${account.id}｜同期済み（${new Date().toLocaleTimeString()}）`);
    } else if (res.error === "wrong_pin" || res.error === "not_found") {
      setSyncStatus("認証エラー。ログインし直してください");
    } else if (res.error === "locked") {
      setSyncStatus("PINエラーが続いたため一時ロック中です");
    } else {
      setSyncStatus("同期エラー（成績は端末に保存済み）");
    }
  } catch (e) {
    setSyncStatus("オフライン（成績は端末に保存済み。次回接続時に同期）");
  } finally {
    syncBusy = false;
  }
}

// タブを閉じる・離れるときに未同期分を送る
window.addEventListener("pagehide", () => {
  if (!account || !SYNC_URL || !syncDirty) return;
  try {
    fetch(SYNC_URL, {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "sync", id: account.id, pin: account.pin, hist: store.hist }),
    });
  } catch (e) { /* 無視 */ }
});

// hist[id] = {c:正解数, w:不正解数, last:"ok"|"ng"|null, mark:bool}
function histOf(id) {
  return store.hist[id] || (store.hist[id] = { c: 0, w: 0, last: null, mark: false });
}
function lastOf(id) {
  const h = store.hist[id];
  return h ? h.last : null;
}

// シャッフルの単元選択。未設定（あとから追加された単元を含む）は
// 「問題があれば選択済み」として扱う
if (!store.sel) store.sel = {};
function selOf(u) {
  const v = store.sel[u.key];
  return v === undefined ? u.questions.length > 0 : v;
}

/* ---------- DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const views = {
  home:   $("#view-home"),
  qlist:  $("#view-qlist"),
  quiz:   $("#view-quiz"),
  result: $("#view-result"),
  stats:  $("#view-stats"),
  login:  $("#view-login"),
};
function show(name) {
  Object.values(views).forEach(v => v.classList.remove("on"));
  views[name].classList.add("on");
  window.scrollTo(0, 0);
}

function unitAcc(u) {
  let seen = 0, ok = 0;
  u.questions.forEach(item => {
    const last = lastOf(item._ref.id);
    if (last !== null) { seen++; if (last === "ok") ok++; }
  });
  return { seen, ok, total: u.questions.length, pct: seen ? Math.round((ok / seen) * 100) : null };
}

/* ============================================================
   ホーム：順番に解く（単元一覧）
   ============================================================ */
let activeSubj = SUBJECTS[0] ? SUBJECTS[0].subject : null;

function renderSubjTabs() {
  const root = $("#subjTabs");
  root.innerHTML = "";
  SUBJECTS.forEach(s => {
    const b = document.createElement("button");
    b.className = "tab" + (s.subject === activeSubj ? " on" : "");
    b.textContent = s.name;
    b.addEventListener("click", () => { activeSubj = s.subject; renderSubjTabs(); renderUnitList(); });
    root.append(b);
  });
}

function renderUnitList() {
  const root = $("#unitList");
  root.innerHTML = "";
  const s = SUBJECTS.find(x => x.subject === activeSubj);
  if (!s) return;
  s.units.forEach(u => {
    const acc = unitAcc(u);
    const row = document.createElement("button");
    row.className = "unit-row" + (acc.total === 0 ? " empty" : "");
    row.disabled = acc.total === 0;

    const name = document.createElement("span");
    name.className = "unit-name";
    name.textContent = u.name;

    const meta = document.createElement("span");
    meta.className = "unit-meta";
    if (acc.total === 0) {
      meta.textContent = "問題未登録";
    } else if (acc.seen === 0) {
      meta.textContent = `${acc.total}問・未着手`;
    } else {
      meta.textContent = `${acc.total}問・正答率${acc.pct}%（${acc.seen}問解答）`;
    }

    const arrow = document.createElement("span");
    arrow.className = "unit-arrow";
    arrow.textContent = acc.total === 0 ? "" : "›";

    row.append(name, meta, arrow);
    row.addEventListener("click", () => openQlist(u));
    root.append(row);
  });
}

/* ============================================================
   問題一覧（単元内・番号を選んで順番に解く）
   ============================================================ */
let qlistUnit = null;

function openQlist(u) {
  qlistUnit = u;
  $("#qlistTitle").textContent = u.label;
  const acc = unitAcc(u);
  $("#qlistMeta").textContent = acc.seen === 0
    ? `全${acc.total}問・未着手`
    : `全${acc.total}問・解答済み${acc.seen}問・正答率${acc.pct}%`;

  const grid = $("#qGrid");
  grid.innerHTML = "";
  u.questions.forEach((item, i) => {
    const q = item._ref;
    const h = store.hist[q.id];
    const b = document.createElement("button");
    b.className = "qcell";
    if (h && h.last === "ok") b.classList.add("ok");
    else if (h && h.last === "ng") b.classList.add("ng");
    if (h && h.mark) b.classList.add("marked");
    b.textContent = i + 1;
    b.addEventListener("click", () => startUnitFrom(u, i));
    grid.append(b);
  });
  show("qlist");
}

$("#btnQlistBack").addEventListener("click", () => { renderUnitList(); show("home"); });
$("#btnUnitStart").addEventListener("click", () => { if (qlistUnit) startUnitFrom(qlistUnit, 0); });

function startUnitFrom(u, startIdx) {
  const list = u.questions.slice(startIdx).map(item => item._ref);
  startQuiz(list, u.label, { unit: u });
}

/* ============================================================
   ホーム：シャッフルで解く（単元チェックボックス）
   ============================================================ */
const opts = { range: "all", count: 25 };

function bindSeg(rootId, key, isNum) {
  const root = document.getElementById(rootId);
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    root.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    opts[key] = isNum ? Number(btn.dataset.val) : btn.dataset.val;
    updateShuffleCount();
  });
}
bindSeg("optRange", "range", false);
bindSeg("optCount", "count", true);

function renderShuffleTree() {
  const root = $("#shuffleTree");
  root.innerHTML = "";
  SUBJECTS.forEach(s => {
    const group = document.createElement("div");
    group.className = "sel-group";

    // 分野見出し＋全選択
    const head = document.createElement("label");
    head.className = "sel-head";
    const headChk = document.createElement("input");
    headChk.type = "checkbox";
    const headTxt = document.createElement("span");
    headTxt.textContent = s.name;
    head.append(headChk, headTxt);
    group.append(head);

    const unitChks = [];
    s.units.forEach(u => {
      const row = document.createElement("label");
      row.className = "sel-row" + (u.questions.length === 0 ? " empty" : "");
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.disabled = u.questions.length === 0;
      chk.checked = selOf(u) && u.questions.length > 0;
      const txt = document.createElement("span");
      txt.textContent = u.name;
      const cnt = document.createElement("small");
      cnt.textContent = u.questions.length ? `${u.questions.length}問` : "未登録";
      row.append(chk, txt, cnt);
      group.append(row);

      chk.addEventListener("change", () => {
        store.sel[u.key] = chk.checked;
        saveStore();
        syncHead();
        updateShuffleCount();
      });
      unitChks.push({ u, chk });
    });

    function syncHead() {
      const enabled = unitChks.filter(x => !x.chk.disabled);
      const checked = enabled.filter(x => x.chk.checked);
      headChk.checked = enabled.length > 0 && checked.length === enabled.length;
      headChk.indeterminate = checked.length > 0 && checked.length < enabled.length;
      headChk.disabled = enabled.length === 0;
    }
    headChk.addEventListener("change", () => {
      unitChks.forEach(({ u, chk }) => {
        if (!chk.disabled) {
          chk.checked = headChk.checked;
          store.sel[u.key] = headChk.checked;
        }
      });
      saveStore();
      syncHead();
      updateShuffleCount();
    });
    syncHead();

    root.append(group);
  });
}

function shufflePool() {
  let pool = BANK.filter(q => selOf(q.unit));
  if (opts.range === "wrong")  pool = pool.filter(q => lastOf(q.id) === "ng");
  if (opts.range === "unseen") pool = pool.filter(q => lastOf(q.id) === null);
  if (opts.range === "marked") pool = pool.filter(q => histOf(q.id).mark);
  return pool;
}

function updateShuffleCount() {
  const n = shufflePool().length;
  const btn = $("#btnStartShuffle");
  const take = opts.count > 0 ? Math.min(opts.count, n) : n;
  btn.textContent = n === 0 ? "シャッフル開始（対象なし）" : `シャッフル開始（${take}問）`;
  btn.disabled = n === 0;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

$("#btnStartShuffle").addEventListener("click", () => {
  let pool = shuffle(shufflePool());
  if (pool.length === 0) return;
  if (opts.count > 0) pool = pool.slice(0, opts.count);
  startQuiz(pool, "シャッフル演習", {});
});

/* ============================================================
   演習
   ============================================================ */
const quiz = {
  list: [],
  idx: 0,
  label: "",
  unit: null,      // 単元通し演習のときだけセット（バッジに問番号を出す）
  answered: false,
  results: [],     // {q, my, correct}
};

const elQCat = $("#qCat"), elQNum = $("#qNum"), elQBar = $("#qBar"), elRunAcc = $("#runAcc");
const elQText = $("#qText"), answerArea = $("#answerArea");
const judgeBox = $("#judgeBox"), judgeMark = $("#judgeMark"), judgeAns = $("#judgeAns");
const expText = $("#expText"), chkMark = $("#chkMark");

function startQuiz(list, label, { unit } = {}) {
  quiz.list = list;
  quiz.idx = 0;
  quiz.label = label;
  quiz.unit = unit || null;
  quiz.results = [];
  updateRunAcc();
  show("quiz");
  renderQuestion();
}

function cur() { return quiz.list[quiz.idx]; }

function updateRunAcc() {
  const n = quiz.results.length;
  if (n === 0) { elRunAcc.textContent = "正答率 —"; return; }
  const ok = quiz.results.filter(r => r.correct).length;
  elRunAcc.textContent = `正答率 ${Math.round((ok / n) * 100)}%（${ok}/${n}）`;
}

function correctLabel(q) {
  if (q.t === "ox") return q.a ? "〇（正しい）" : "×（誤り）";
  return `${CIRCLED[q.a] || ""}${q.c[q.a]}`;
}

function renderQuestion() {
  const q = cur();
  quiz.answered = false;

  elQCat.textContent = quiz.unit ? `${q.subjectName} 問${q.no}` : `${q.subjectName}・${q.unit.name} 問${q.no}`;
  elQNum.textContent = `${quiz.idx + 1} / ${quiz.list.length}`;
  elQBar.style.width = `${(quiz.idx / quiz.list.length) * 100}%`;
  elQText.textContent = q.q;
  judgeBox.hidden = true;

  answerArea.innerHTML = "";
  if (q.t === "ox") {
    const row = document.createElement("div");
    row.className = "answer-row";
    row.append(makeOxBtn(true), makeOxBtn(false));
    answerArea.append(row);
  } else {
    const col = document.createElement("div");
    col.className = "mc-col";
    q.c.forEach((choice, i) => {
      const b = document.createElement("button");
      b.className = "mc-btn";
      b.dataset.idx = i;
      const num = document.createElement("span");
      num.className = "mc-num";
      num.textContent = CIRCLED[i] || `${i + 1}.`;
      const txt = document.createElement("span");
      txt.className = "mc-txt";
      txt.textContent = choice;
      b.append(num, txt);
      b.addEventListener("click", () => answer(i));
      col.append(b);
    });
    answerArea.append(col);
  }
}

function makeOxBtn(val) {
  const b = document.createElement("button");
  b.className = `ans-btn ${val ? "ans-o" : "ans-x"}`;
  b.dataset.ox = val ? "o" : "x";
  b.innerHTML = `<span class="ans-symbol">${val ? "〇" : "×"}</span><span class="ans-word">${val ? "正しい" : "誤り"}</span>`;
  b.addEventListener("click", () => answer(val));
  return b;
}

function answer(my) {           // ox: true/false, mc: 選択index
  if (quiz.answered) return;
  quiz.answered = true;
  const q = cur();
  const correct = (my === q.a);

  const h = histOf(q.id);
  correct ? h.c++ : h.w++;
  h.last = correct ? "ok" : "ng";
  saveStore();

  quiz.results.push({ q, my, correct });
  updateRunAcc();

  // ボタンのハイライト
  if (q.t === "ox") {
    answerArea.querySelectorAll(".ans-btn").forEach(b => {
      b.disabled = true;
      const val = b.dataset.ox === "o";
      if (val === q.a) b.classList.add("picked-correct");
      else if (val === my) b.classList.add("picked-wrong");
    });
  } else {
    answerArea.querySelectorAll(".mc-btn").forEach(b => {
      b.disabled = true;
      const i = Number(b.dataset.idx);
      if (i === q.a) b.classList.add("mc-correct");
      else if (i === my) b.classList.add("mc-wrong");
    });
  }

  judgeMark.textContent = correct ? "正解！" : "不正解…";
  judgeMark.className = `judge-mark ${correct ? "ok" : "ng"}`;
  judgeAns.textContent = `正解は ${correctLabel(q)}`;
  expText.textContent = q.exp;
  chkMark.checked = h.mark;
  judgeBox.hidden = false;
  elQBar.style.width = `${((quiz.idx + 1) / quiz.list.length) * 100}%`;
  $("#btnNext").textContent = quiz.idx + 1 >= quiz.list.length ? "結果を見る" : "次の問題へ";
}

chkMark.addEventListener("change", () => {
  histOf(cur().id).mark = chkMark.checked;
  saveStore();
});

$("#btnNext").addEventListener("click", nextQuestion);
function nextQuestion() {
  if (!quiz.answered) return;
  quiz.idx++;
  if (quiz.idx >= quiz.list.length) return showResult();
  renderQuestion();
}

$("#btnQuit").addEventListener("click", () => {
  if (quiz.results.length > 0) showResult();
  else goHome();
});

/* キー操作 */
document.addEventListener("keydown", (e) => {
  if (!views.quiz.classList.contains("on")) return;
  const q = cur();
  if (!q) return;
  if (e.key === "Enter") { e.preventDefault(); nextQuestion(); return; }
  if (quiz.answered) return;
  if (q.t === "ox") {
    if (e.key === "o" || e.key === "O") answer(true);
    else if (e.key === "x" || e.key === "X") answer(false);
  } else {
    const n = Number(e.key);
    if (n >= 1 && n <= q.c.length) answer(n - 1);
  }
});

/* ============================================================
   結果
   ============================================================ */
function showResult() {
  const total = quiz.results.length;
  const ok = quiz.results.filter(r => r.correct).length;
  $("#scorePct").textContent = total ? Math.round((ok / total) * 100) : 0;
  $("#scoreDetail").textContent = `${quiz.label}｜${total}問中 ${ok}問正解`;
  $("#btnRetryWrong").disabled = (ok === total);

  const ul = $("#reviewList");
  ul.innerHTML = "";
  quiz.results.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "review-item";
    const details = document.createElement("details");

    const summary = document.createElement("summary");
    const mk = document.createElement("span");
    mk.className = `rv-mark ${r.correct ? "ok" : "ng"}`;
    mk.textContent = r.correct ? "〇" : "×";
    const qt = document.createElement("span");
    qt.className = "rv-q";
    qt.textContent = `${i + 1}. ${r.q.q}`;
    const an = document.createElement("span");
    an.className = "rv-ans";
    an.textContent = r.q.t === "ox" ? `正解:${r.q.a ? "〇" : "×"}` : `正解:${CIRCLED[r.q.a]}`;
    summary.append(mk, qt, an);

    const exp = document.createElement("div");
    exp.className = "rv-exp";
    exp.textContent = (r.q.t === "mc" ? `正解：${correctLabel(r.q)}\n` : "") + r.q.exp;

    details.append(summary, exp);
    li.append(details);
    ul.append(li);
  });

  show("result");
  syncNow();   // 演習が一区切りしたタイミングで即同期
}

$("#btnRetryWrong").addEventListener("click", () => {
  const wrongs = quiz.results.filter(r => !r.correct).map(r => r.q);
  if (wrongs.length) startQuiz(shuffle(wrongs), "間違い直し", {});
});
$("#btnBackHome").addEventListener("click", goHome);

/* ============================================================
   成績（分野ごとの得点率＋単元内訳）
   ============================================================ */
function renderStats() {
  const body = $("#statsBody");
  body.innerHTML = "";
  SUBJECTS.forEach(s => {
    let seen = 0, ok = 0, total = 0;
    s.units.forEach(u => {
      total += u.questions.length;
      const a = unitAcc(u);
      seen += a.seen; ok += a.ok;
    });
    const pct = seen ? Math.round((ok / seen) * 100) : 0;

    const box = document.createElement("div");
    box.className = "stat-subject";

    const row = document.createElement("div");
    row.className = "stat-row main";
    row.innerHTML = `
      <div class="stat-top">
        <span class="stat-name"></span>
        <span class="stat-nums"></span>
        <span class="stat-pct"></span>
      </div>
      <div class="stat-bar"><div></div></div>`;
    row.querySelector(".stat-name").textContent = s.name;
    row.querySelector(".stat-nums").textContent = `解答済み ${seen} / ${total}問`;
    row.querySelector(".stat-pct").textContent = seen ? `${pct}%` : "—";
    row.querySelector(".stat-bar > div").style.width = `${seen ? pct : 0}%`;
    box.append(row);

    s.units.forEach(u => {
      if (u.questions.length === 0) return;
      const a = unitAcc(u);
      const sub = document.createElement("div");
      sub.className = "stat-unit";
      sub.innerHTML = `<span class="su-name"></span><span class="su-nums"></span><span class="su-pct"></span>`;
      sub.querySelector(".su-name").textContent = u.name;
      sub.querySelector(".su-nums").textContent = `${a.seen}/${a.total}問`;
      sub.querySelector(".su-pct").textContent = a.pct === null ? "—" : `${a.pct}%`;
      box.append(sub);
    });

    body.append(box);
  });
}

$("#navStats").addEventListener("click", () => {
  // 成績表示中にもう一度押すと閉じてホームへ戻る（トグル）
  if (views.stats.classList.contains("on")) { goHome(); return; }
  renderStats();
  show("stats");
});
$("#btnStatsHome").addEventListener("click", goHome);
$("#btnResetHist").addEventListener("click", () => {
  if (confirm("解答履歴（正誤・チェック）をすべて削除します。よろしいですか？")) {
    store.hist = {};
    saveStore();
    renderStats();
  }
});

/* ---------- ホームへ ---------- */
function goHome() {
  renderUnitList();
  updateShuffleCount();
  show("home");
}
const brand = $("#brandHome");
brand.addEventListener("click", goHome);
brand.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") goHome();
});

/* ============================================================
   ログイン／アカウント（config.js で同期サーバーURL設定時のみ有効）
   ============================================================ */
const navUser = $("#navUser");
let loginMode = "login";

function updateAccountUI() {
  if (!SYNC_URL) { navUser.hidden = true; return; }
  navUser.hidden = false;
  navUser.textContent = account ? account.id : "ログイン";
  setSyncStatus(account ? `${account.id} でログイン中` : "未ログイン（成績はこの端末のみに保存されます）");
}

function setLoginMode(mode) {
  loginMode = mode;
  $("#loginTitle").textContent = mode === "login" ? "ログイン" : "新規登録";
  $("#btnDoLogin").textContent = mode === "login" ? "ログイン" : "登録する";
  $("#btnToRegister").textContent = mode === "login" ? "はじめての人はこちら（新規登録）" : "アカウントがある人はこちら（ログイン）";
  $("#loginMsg").textContent = "";
}

navUser.addEventListener("click", () => {
  if (account) {
    if (confirm(`${account.id} からログアウトしますか？\n（この端末はゲストの記録に戻ります。アカウントの成績はサーバーに保存済みです）`)) {
      syncNow();
      account = null;
      localStorage.removeItem(ACCOUNT_KEY);
      store = loadStore();
      if (!store.sel) store.sel = {};
      updateAccountUI();
      renderShuffleTree();
      goHome();
    }
  } else {
    setLoginMode("login");
    show("login");
  }
});

$("#btnToRegister").addEventListener("click", () => setLoginMode(loginMode === "login" ? "register" : "login"));
$("#btnLoginBack").addEventListener("click", goHome);
$("#btnDoLogin").addEventListener("click", doAuth);
["loginId", "loginPin"].forEach(idName => {
  document.getElementById(idName).addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAuth();
  });
});

async function doAuth() {
  const id = $("#loginId").value.trim();
  const pin = $("#loginPin").value.trim();
  const msg = $("#loginMsg");
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(id)) { msg.textContent = "IDは半角英数字3〜20文字で入力してください（-、_も可）"; return; }
  if (!/^[0-9]{4}$/.test(pin)) { msg.textContent = "PINは数字4桁で入力してください"; return; }
  msg.textContent = "通信中…";
  $("#btnDoLogin").disabled = true;
  try {
    const takeover = $("#chkTakeover").checked;
    const guestHist = loadStoreRaw(GUEST_KEY).hist;
    const payload = { action: loginMode, id, pin };
    if (loginMode === "register" && takeover) payload.hist = guestHist;
    const res = await api(payload);
    if (!res.ok) {
      msg.textContent = {
        id_taken: "そのIDはすでに使われています。別のIDにするか、ログインしてください",
        not_found: "そのIDは登録されていません（「新規登録」から作成してください）",
        wrong_pin: "PINが違います",
        locked: "PINの間違いが続いたため一時ロック中です。10分ほどおいて再試行してください",
        bad_id: "IDの形式が正しくありません",
        bad_pin: "PINは数字4桁です",
      }[res.error] || "エラーが発生しました";
      return;
    }
    account = { id, pin };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    // サーバーの履歴と、この端末に残っているアカウントの履歴（＋引き継ぎ指定ならゲスト履歴）をマージ
    const cached = loadStoreRaw(lsKey());
    let hist = mergeHist(cached.hist, res.hist || {});
    if (takeover) hist = mergeHist(hist, guestHist);
    store = { hist, sel: cached.sel || loadStoreRaw(GUEST_KEY).sel || null };
    if (!store.sel) store.sel = {};
    saveStoreLocal();
    $("#loginPin").value = "";
    updateAccountUI();
    renderShuffleTree();
    goHome();
    syncNow();   // マージ結果をサーバーへ反映
  } catch (e) {
    msg.textContent = "サーバーに接続できませんでした。通信環境を確認してください";
  } finally {
    $("#btnDoLogin").disabled = false;
  }
}

/* ---------- 初期描画 ---------- */
renderSubjTabs();
renderUnitList();
renderShuffleTree();
updateShuffleCount();
updateAccountUI();
if (account) syncNow();   // 起動時にサーバーの最新成績を取り込む

})();
