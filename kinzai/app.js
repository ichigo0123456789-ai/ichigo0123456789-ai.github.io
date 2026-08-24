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

/* ---------- 履歴 (localStorage) ---------- */
const LS_KEY = "kinzai-dojo-v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object") return { hist: s.hist || {}, sel: s.sel || null };
    }
  } catch (e) { /* 破損時は初期化 */ }
  return { hist: {}, sel: null };
}
function saveStore() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* 容量超過などは無視 */ }
}
let store = loadStore();

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

$("#navStats").addEventListener("click", () => { renderStats(); show("stats"); });
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

/* ---------- 初期描画 ---------- */
renderSubjTabs();
renderUnitList();
renderShuffleTree();
updateShuffleCount();

})();
