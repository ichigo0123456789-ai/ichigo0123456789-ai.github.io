/* ============================================================
   金のフレーズ風 単語帳  —  アプリロジック
   - 音声   : Web Speech API (SpeechSynthesis) で英語を読み上げ
   - 履歴   : localStorage に「覚えた単語」「クイズ結果」を保存
   ============================================================ */
'use strict';

/* ---------- ストレージ ---------- */
const LS = {
  known:  'tango_known_v1',      // 覚えた単語ID配列
  weak:   'tango_weak_v1',       // 覚えてない（要復習）単語ID配列
  quiz:   'tango_quiz_hist_v1',  // クイズ履歴
  user:   'tango_user_words_v1', // ユーザーがインポートした単語（この端末のみ）
  filter: 'tango_filter_v1',     // 絞り込み状態（レベル/カテゴリ/検索）
  hide:   'tango_hidemode_v1',   // 意味を隠す暗記モード
};
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let known = new Set(load(LS.known, []));
let weak = new Set(load(LS.weak, []));
let quizHist = load(LS.quiz, []);
let userWords = load(LS.user, []); // [{word, ipa, pos, vt, ja, ex, exJa, level, cat}]

/* ------------------------------------------------------------
   有効な単語カタログ＝ 組み込み単語 ＋ ユーザーのインポート単語
   ※ ユーザー単語は localStorage にのみ保存され、公開/送信されません
   ------------------------------------------------------------ */
const USER_ID_BASE = 100001;
let CATALOG = [];
function rebuildCatalog(){
  const base  = WORDS.map(w => ({ ...w, src:'builtin' }));
  const extra = userWords.map((w, i) => ({
    id: USER_ID_BASE + i, src:'user',
    word: w.word || '', ipa: w.ipa || '', pos: w.pos || 'noun', vt: w.vt || '',
    ja: w.ja || '', ex: w.ex || '', exJa: w.exJa || '',
    level: w.level || 600, cat: w.cat || 'マイ単語',
  }));
  CATALOG = base.concat(extra).map((w, i) => ({ ...w, no: i + 1 }));
}
rebuildCatalog();

/* ------------------------------------------------------------
   旧100語版words.jsの「覚えた」IDを、単語つづり経由で新IDへ移行する
   一回限りの処理（2026-07-14 words.js 1000語版への差し替えに伴う） */
(function migrateKnownV1(){
  const FLAG = 'tango_known_v1_to_v2_done';
  try {
    if (localStorage.getItem(FLAG)) return;
    const OLD_ID_WORDS = [
      'available','attend','receipt','apply','provide','increase','reduce','schedule','customer','employee',
      'purchase','discount','deliver','require','department','appointment','confirm','invoice','colleague','expense',
      'maintain','recommend','complete','available','reserve','local','repair','offer','contain','describe',
      'efficient','install','negotiate','submit','budget','expand','approve','colleague','warranty','itinerary',
      'colleague','renovate','inventory','promote','assemble','reimburse','vendor','deadline','facility','launch',
      'outstanding','replace','proceed','acquire','complimentary','anticipate','beverage','prompt','distribute','venue',
      'comprehensive','implement','streamline','consecutive','endorse','tentative','allocate','prospective','overhaul','mandatory',
      'delegate','lucrative','compile','incentive','feasible','expedite','proficient','disclose','versatile','oversee',
      'subsidiary','diligent','initiative','surpass','contingent','unprecedented','discrepancy','meticulous','contingency','prudent',
      'consolidate','forfeit','scrutinize','impending','remittance','culminate','stringent','defer','quorum','amenity'
    ];
    const byWord = new Map(WORDS.map(w => [w.word, w.id]));
    const next = new Set();
    known.forEach(id => {
      if (id >= USER_ID_BASE){ next.add(id); return; }
      const nid = byWord.get(OLD_ID_WORDS[id - 1]);
      if (nid) next.add(nid);
    });
    known = next;
    save(LS.known, [...known]);
    localStorage.setItem(FLAG, '1');
  } catch (e) {}
})();

/* ---------- 状態（リロードしても保持されるよう localStorage に保存） ---------- */
const savedFilter = load(LS.filter, {});
let filterLevel = savedFilter.level || 'all';
let filterCat = savedFilter.cat || 'all';
let searchQ = savedFilter.q || '';
function saveFilter(){ save(LS.filter, { level: filterLevel, cat: filterCat, q: searchQ }); }
let hideMeaning = load(LS.hide, true);  // 既定: 意味を隠す（暗記モードON）

/* ---------- 音声 ----------
   端末によっては getVoices() がページ読込直後は空で、
   そのまま話すと端末既定（日本語）ボイスで英単語が読まれてしまう。
   対策: ①voiceschanged ②ポーリング ③speak() 直前 の3段階で英語ボイスを取得する */
let enVoice = null;
function pickVoice(){
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  enVoice = vs.find(v => /en[-_]US/i.test(v.lang) && /Google US English/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang) && /Natural|Neural|Premium|Enhanced|Samantha|Aria|Jenny|Zira|David/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang) && v.localService)
         || vs.find(v => /en[-_]US/i.test(v.lang))
         || vs.find(v => /^en[-_]/i.test(v.lang))
         || vs.find(v => /^en$/i.test(v.lang))
         || null;
}
if ('speechSynthesis' in window){
  pickVoice();
  if ('onvoiceschanged' in speechSynthesis){
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  let vTries = 0;
  const vTimer = setInterval(() => {
    if (enVoice || ++vTries > 20){ clearInterval(vTimer); return; }
    pickVoice();
  }, 250);
}
let speaking = null;
let voiceWarned = false;
function speak(text, btn){
  if (!('speechSynthesis' in window)){ toast('この端末は音声に対応していません'); return; }
  if (!enVoice) pickVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = (enVoice && enVoice.lang) || 'en-US';
  u.rate = 0.92; u.pitch = 1;
  if (enVoice){ u.voice = enVoice; }
  else {
    // iOSはボイス一覧が空でも lang 指定で英語再生されるため、
    // 一覧が取得できているのに英語ボイスが無い場合のみ警告する
    const vsNow = speechSynthesis.getVoices();
    if (vsNow.length && !voiceWarned){
      voiceWarned = true;
      toast('英語音声が見つかりません。端末に英語TTSを追加すると正しく再生されます');
    }
  }
  if (btn){
    if (speaking) speaking.classList.remove('playing');
    btn.classList.add('playing'); speaking = btn;
    u.onend = u.onerror = () => { btn.classList.remove('playing'); if (speaking===btn) speaking=null; };
  }
  // Android Chrome: cancel()直後のspeakが無視される既知問題への対策で少し遅らせる
  setTimeout(() => speechSynthesis.speak(u), 60);
}
// 熟語を読み上げる。A/B/be/do等のプレースホルダは除いて自然な形で発音する
function speakPhrase(ph, btn){
  if (!ph) return;
  const t = ph.replace(/\bbe\b/, '')
              .replace(/\b[AB]\b/g, '')
              .replace(/\bdoing\b/g, '')
              .replace(/\bdo\b/g, '')
              .replace(/\s+/g, ' ').trim();
  speak(t || ph, btn);
}

/* ---------- トースト ---------- */
let toastT;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600);
}

/* ---------- 品詞ラベル ---------- */
const POS_JA = { noun:'名詞', verb:'動詞', adj:'形容詞', adv:'副詞', prep:'前置詞', conj:'接続詞', phrase:'熟語' };
const VT_JA  = { t:'他動詞', i:'自動詞', ti:'自動詞・他動詞' };

// 品詞バッジ：動詞は「自動詞/他動詞」を品詞として表示（重複させない）
function posBadge(w){
  if (w.pos === 'verb' && w.vt) return { text: VT_JA[w.vt], cls: 'b-vt' };
  return { text: POS_JA[w.pos] || w.pos, cls: 'b-pos' };
}
// 意味中の **…** を太字に（よりメジャーな語義の強調用）。先にHTMLエスケープ
function jaHtml(ja){
  return esc(ja).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* ============================================================
   単語帳リスト描画
   ============================================================ */
function filteredWords(){
  return CATALOG.filter(w => {
    if (filterLevel === 'known'   && !known.has(w.id)) return false;
    if (filterLevel === 'weak'    && !weak.has(w.id)) return false;
    if (filterLevel === 'unknown' && (known.has(w.id) || weak.has(w.id))) return false;
    if (['600','730','860','990'].includes(filterLevel) && String(w.level) !== filterLevel) return false;
    if (filterCat !== 'all' && w.cat !== filterCat) return false;
    if (searchQ){
      const q = searchQ.toLowerCase();
      if (!w.word.toLowerCase().includes(q) && !(w.ja||'').includes(searchQ)) return false;
    }
    return true;
  });
}

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function renderList(){
  const list = document.getElementById('list');
  const items = filteredWords();
  document.getElementById('count').textContent =
    `${items.length}語　（覚えた ${known.size}／覚えてない ${weak.size}／全${CATALOG.length}語）`;

  if (!items.length){
    list.innerHTML = '<div class="empty">該当する単語がありません。</div>';
    return;
  }
  list.innerHTML = items.map(w => {
    const isKnown = known.has(w.id);
    const isWeak = weak.has(w.id);
    const posLabel = posBadge(w);
    return `
    <article class="card ${isKnown?'known':''} ${isWeak?'weak':''}" data-id="${w.id}">
      <div class="head">
        <div class="no">${w.no}</div>
        <div class="core">
          <div class="wordline">
            <button class="en" data-act="play" title="タップで発音">${esc(w.word)}</button>
            <span class="ipa">${esc(w.ipa||'')}</span>
          </div>
          ${w.ph ? `<div class="collo">
            <button class="collo-word" data-act="phrase" title="熟語を再生"><span class="cbadge">熟</span>${esc(w.ph)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.7 6.4 8.3H3v7.4h3.4L11 19.3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
            </button>${w.phj ? `<span class="collo-ja">${esc(w.phj)}</span>` : ''}
          </div>` : ''}
          <div class="badges">
            <span class="badge ${posLabel.cls}">${posLabel.text}</span>
            <span class="badge b-lv">${w.level}点</span>
          </div>
          <div class="reveal-hint">タップして意味を表示</div>
          ${w.senses ? `<div class="senses">${w.senses.map(s =>
            `<div class="sense"><span class="pos-tag">${esc(s.p)}</span><span class="sense-ja">${jaHtml(s.ja)}</span></div>`).join('')}</div>`
            : `<p class="ja">${jaHtml(w.ja)}</p>`}
          ${w.ex ? `<div class="ex" hidden>
            <span class="en2">${esc(w.ex)}</span>
            <span class="ja2">${esc(w.exJa||'')}</span>
          </div>
          <button class="expandbtn" data-act="expand">例文
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>` : ''}
        </div>
        <div class="marks">
          <button class="knowbtn markbtn ${isKnown?'on':''}" data-act="know" title="覚えた">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span>覚えた</span>
          </button>
          <button class="weakbtn markbtn ${isWeak?'on':''}" data-act="weak" title="覚えてない">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            <span>覚えて<br>ない</span>
          </button>
        </div>
      </div>
    </article>`;
  }).join('');
}

/* 覚えた/覚えてない の表示更新 */
function updateMarkUI(card, id){
  const isKnown = known.has(id), isWeak = weak.has(id);
  card.classList.toggle('known', isKnown);
  card.classList.toggle('weak', isWeak);
  const kb = card.querySelector('.knowbtn'), wb = card.querySelector('.weakbtn');
  if (kb) kb.classList.toggle('on', isKnown);
  if (wb) wb.classList.toggle('on', isWeak);
  document.getElementById('count').textContent =
    `${filteredWords().length}語　（覚えた ${known.size}／覚えてない ${weak.size}／全${CATALOG.length}語）`;
  // 絞り込み中のタブに影響する場合は一覧を作り直す
  if (['known','weak','unknown'].includes(filterLevel)) renderList();
}

/* リストのクリック（イベント委譲） */
document.getElementById('list').addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = +card.dataset.id;
  const w = CATALOG.find(x => x.id === id);
  const btn = e.target.closest('[data-act]');
  const act = btn && btn.dataset.act;

  if (act === 'play'){ speak(w.word, btn); }
  else if (act === 'phrase'){ speakPhrase(w.ph, btn); }
  else if (act === 'know'){
    if (known.has(id)){ known.delete(id); }
    else { known.add(id); weak.delete(id); toast('覚えたに追加しました'); }  // 覚えた⇔覚えてないは排他
    save(LS.known, [...known]); save(LS.weak, [...weak]);
    updateMarkUI(card, id);
  }
  else if (act === 'weak'){
    if (weak.has(id)){ weak.delete(id); }
    else { weak.add(id); known.delete(id); toast('覚えてないに追加しました'); }
    save(LS.known, [...known]); save(LS.weak, [...weak]);
    updateMarkUI(card, id);
  }
  else if (act === 'expand'){
    const ex = card.querySelector('.ex');
    ex.hidden = !ex.hidden;
    card.classList.toggle('open', !ex.hidden);
  }

  // 暗記モード: カード本体（ボタン以外）のタップでのみ意味表示を切り替え
  // 発音（単語・熟語）や 覚えた/覚えてない では意味を表示しない
  if (hideMeaning && !act){
    card.classList.toggle('revealed');
  }
});

/* カテゴリチップ生成 */
function renderCats(){
  const cats = [...new Set(CATALOG.map(w => w.cat).filter(Boolean))];
  const el = document.getElementById('catFilter');
  el.innerHTML = `<button class="chip ${filterCat==='all'?'on':''}" data-cat="all">全カテゴリ</button>` +
    cats.map(c => `<button class="chip ${filterCat===c?'on':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}
document.getElementById('catFilter').addEventListener('click', e => {
  const c = e.target.closest('[data-cat]'); if (!c) return;
  filterCat = c.dataset.cat; saveFilter(); renderCats(); renderList();
});

/* レベルタブ */
document.getElementById('levelTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  filterLevel = t.dataset.level;
  document.querySelectorAll('#levelTabs .tab').forEach(x => x.classList.toggle('on', x===t));
  saveFilter(); renderList();
});

/* 検索 */
let searchT;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { searchQ = e.target.value.trim(); saveFilter(); renderList(); }, 200);
});

/* 暗記モード（意味を隠す）トグル */
function applyHideMode(){
  document.getElementById('list').classList.toggle('hide-mode', hideMeaning);
  const btn = document.getElementById('hideToggle');
  btn.classList.toggle('on', hideMeaning);
  btn.setAttribute('aria-pressed', String(hideMeaning));
  btn.querySelector('.lbl').textContent = hideMeaning ? '意味を隠す：ON' : '意味を隠す：OFF';
}
document.getElementById('hideToggle').addEventListener('click', () => {
  hideMeaning = !hideMeaning;
  save(LS.hide, hideMeaning);
  if (hideMeaning) document.querySelectorAll('.card.revealed').forEach(c => c.classList.remove('revealed'));
  applyHideMode();
});

/* ============================================================
   ビュー切り替え（ボトムナビ）
   ============================================================ */
let listScroll = 0;  // 単語帳のスクロール位置を保持
document.querySelector('.nav .in').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  const v = b.dataset.view;
  // 単語帳から離れるときは今のスクロール位置を覚えておく
  const cur = document.querySelector('.view.on');
  if (cur && cur.id === 'view-list') listScroll = window.scrollY;

  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('on', x===b));
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on'));
  document.getElementById('view-'+v).classList.add('on');

  if (v === 'quiz') renderQuizSetup();
  if (v === 'history') renderStats();
  // 単語帳に戻るときは元の位置へ、それ以外は先頭へ
  window.scrollTo(0, v === 'list' ? listScroll : 0);
});

/* ============================================================
   リロード時のスクロール位置維持（アンカー方式）
   - 画面上部にあるカードのIDと、その表示位置を記録
   - リロード後はそのカードが同じ位置に来るようスクロール
   - 意味の表示状態でカード高さが変わっても位置がズレない
   ============================================================ */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const SC_KEY = 'tango_scroll_v1';
const TOP_GAP = 56;  // 上部の基準位置（sticky帯の下あたり）

function saveScrollAnchor(){
  if (!document.getElementById('view-list').classList.contains('on')) return;
  if (window.scrollY < 4){ try{ sessionStorage.removeItem(SC_KEY); }catch{} return; }
  let anchor = null;
  for (const c of document.querySelectorAll('#list .card')){
    if (c.getBoundingClientRect().bottom > TOP_GAP){ anchor = c; break; }
  }
  if (!anchor) return;
  try {
    sessionStorage.setItem(SC_KEY, JSON.stringify({
      id: anchor.dataset.id,
      top: Math.round(anchor.getBoundingClientRect().top),
    }));
  } catch {}
}
function restoreScrollAnchor(){
  let d;
  try { d = JSON.parse(sessionStorage.getItem(SC_KEY)); } catch { return; }
  if (!d || !d.id) return;
  const card = document.querySelector('#list .card[data-id="'+d.id+'"]');
  if (!card) return;
  const absTop = card.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, Math.max(0, absTop - d.top));
}
let scSaveT;
window.addEventListener('scroll', () => {
  clearTimeout(scSaveT);
  scSaveT = setTimeout(saveScrollAnchor, 150);
}, { passive: true });
window.addEventListener('pagehide', saveScrollAnchor);

/* ============================================================
   クイズ
   ============================================================ */
let quiz = null; // {items, i, correct, dir, results}

function renderQuizSetup(){
  if (quiz) return; // 進行中なら再描画しない
  const area = document.getElementById('quizArea');
  area.innerHTML = `
    <div class="panel">
      <h2>クイズに挑戦</h2>
      <p class="lead">出題範囲を選んでスタート。結果は自動で履歴に保存されます。</p>
      <div class="field">
        <label>出題形式</label>
        <div class="seg" id="qDir">
          <button class="on" data-dir="e2j">英語 → 意味</button>
          <button data-dir="j2e">意味 → 英語</button>
        </div>
      </div>
      <div class="field">
        <label>レベル</label>
        <div class="seg" id="qLevel">
          <button class="on" data-lv="all">すべて</button>
          <button data-lv="600">600</button>
          <button data-lv="730">730</button>
          <button data-lv="860">860</button>
          <button data-lv="990">990</button>
          <button data-lv="known">覚えた</button>
          <button data-lv="weak">覚えてない</button>
        </div>
      </div>
      <div class="field">
        <label>問題数</label>
        <div class="seg" id="qNum">
          <button data-n="5">5問</button>
          <button class="on" data-n="10">10問</button>
          <button data-n="20">20問</button>
        </div>
      </div>
      <button class="btn-primary" id="qStart">スタート</button>
    </div>`;

  area.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x===b));
  }));
  document.getElementById('qStart').addEventListener('click', startQuiz);
}

function shuffle(a){ a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function startQuiz(){
  const dir = document.querySelector('#qDir .on').dataset.dir;
  const lv  = document.querySelector('#qLevel .on').dataset.lv;
  const n   = +document.querySelector('#qNum .on').dataset.n;

  let pool = CATALOG.slice();
  if (['600','730','860','990'].includes(lv)) pool = pool.filter(w => String(w.level)===lv);
  else if (lv === 'known') pool = pool.filter(w => known.has(w.id));
  else if (lv === 'weak') pool = pool.filter(w => weak.has(w.id));

  if (pool.length < 4){
    toast(lv === 'weak' ? '「覚えてない」の単語が4語以上必要です' : '出題できる単語が足りません（4語以上必要）');
    return;
  }
  const items = shuffle(pool).slice(0, Math.min(n, pool.length));
  quiz = { items, i:0, correct:0, dir, results:[] };
  renderQuestion();
}

function renderQuestion(){
  const area = document.getElementById('quizArea');
  const q = quiz.items[quiz.i];
  const isE2J = quiz.dir === 'e2j';

  // 選択肢（正解 + 同じ形式のダミー3つ）
  const distractPool = CATALOG.filter(w => w.id !== q.id && w.ja !== q.ja && w.word !== q.word);
  const opts = shuffle([q, ...shuffle(distractPool).slice(0,3)]);
  const label = o => isE2J ? o.ja : o.word;

  area.innerHTML = `
    <div class="panel">
      <div class="q-top">
        <span>第 ${quiz.i+1} / ${quiz.items.length} 問</span>
        <span>正解 ${quiz.correct}</span>
      </div>
      <div class="progress"><i style="width:${(quiz.i/quiz.items.length)*100}%"></i></div>
      <div class="q-word">
        <div class="prompt">${isE2J ? 'この単語の意味は？' : 'この意味の英単語は？'}</div>
        ${isE2J
          ? `<div class="en">${esc(q.word)}</div><div class="ipa">${esc(q.ipa||'')}</div>${q.ph?`<div class="q-collo"><span class="cbadge">熟</span>${esc(q.ph)}</div>`:''}`
          : `<div class="ja">${jaHtml(q.ja)}</div>`}
      </div>
      ${isE2J ? `<div class="q-audio"><button id="qPlay" aria-label="音声"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.7 6.4 8.3H3v7.4h3.4L11 19.3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button></div>` : ''}
      <div class="opts" id="qOpts">
        ${opts.map(o => `<button class="opt" data-id="${o.id}">${isE2J ? jaHtml(o.ja) : esc(o.word)}</button>`).join('')}
      </div>
    </div>`;

  if (isE2J){
    const pb = document.getElementById('qPlay');
    speak(q.word); // 出題時に自動再生
    pb.addEventListener('click', () => speak(q.word, null));
  }

  let answered = false;
  document.getElementById('qOpts').addEventListener('click', e => {
    const b = e.target.closest('.opt'); if (!b || answered) return;
    answered = true;
    const chosen = +b.dataset.id;
    const ok = chosen === q.id;
    document.querySelectorAll('#qOpts .opt').forEach(o => {
      o.disabled = true;
      if (+o.dataset.id === q.id) o.classList.add('correct');
      else if (+o.dataset.id === chosen) o.classList.add('wrong');
    });
    if (ok) quiz.correct++;
    quiz.results.push({ word:q.word, ja:q.ja, ok });
    setTimeout(() => {
      quiz.i++;
      if (quiz.i >= quiz.items.length) finishQuiz();
      else renderQuestion();
    }, ok ? 650 : 1150);
  });
}

function finishQuiz(){
  const total = quiz.items.length;
  const score = quiz.correct;
  const pct = Math.round(score/total*100);

  // 履歴に保存
  const rec = {
    date: new Date().toISOString(),
    dir: quiz.dir, total, score, pct,
    wrong: quiz.results.filter(r => !r.ok).map(r => r.word),
  };
  quizHist.unshift(rec);
  quizHist = quizHist.slice(0, 50);
  save(LS.quiz, quizHist);

  const msg = pct===100 ? '満点！お見事です🎉' : pct>=80 ? 'よくできました！' : pct>=50 ? 'その調子！復習しよう' : 'もう一度チャレンジ！';
  const area = document.getElementById('quizArea');
  area.innerHTML = `
    <div class="panel result">
      <div class="score">${score}<small>/${total}</small></div>
      <div class="msg">${msg}（正答率 ${pct}%）</div>
      <div class="detail">
        ${quiz.results.map(r => `
          <div class="rrow">
            <span class="dot ${r.ok?'ok':'ng'}"></span>
            <span class="w">${esc(r.word)}</span>
            <span class="m">${jaHtml(r.ja)}</span>
          </div>`).join('')}
      </div>
      <button class="btn-primary" id="qAgain">もう一度</button>
      <button class="btn-ghost" id="qHome">履歴を見る</button>
    </div>`;
  quiz = null;
  document.getElementById('qAgain').addEventListener('click', renderQuizSetup);
  document.getElementById('qHome').addEventListener('click', () => {
    document.querySelector('.nav button[data-view="history"]').click();
  });
}

/* ============================================================
   履歴 / 統計
   ============================================================ */
function fmtDate(iso){
  const d = new Date(iso);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderStats(){
  const area = document.getElementById('statsArea');
  const totalQ = quizHist.reduce((s,h) => s+h.total, 0);
  const totalC = quizHist.reduce((s,h) => s+h.score, 0);
  const avg = totalQ ? Math.round(totalC/totalQ*100) : 0;

  area.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="n">${known.size}</div><div class="l">覚えた単語</div></div>
      <div class="stat"><div class="n" style="color:var(--red)">${weak.size}</div><div class="l">覚えてない</div></div>
      <div class="stat"><div class="n">${avg}<span style="font-size:1rem">%</span></div><div class="l">平均正答率</div></div>
    </div>

    <div class="sec-title">クイズ履歴</div>
    ${quizHist.length ? quizHist.map((h,idx) => {
      const hue = h.pct>=80 ? 'var(--green)' : h.pct>=50 ? 'var(--gold-deep)' : 'var(--red)';
      return `
      <div class="hist-item">
        <div class="ring" style="background:conic-gradient(${hue} ${h.pct*3.6}deg, var(--line-2) 0);color:${hue}">
          <span style="background:var(--surface);width:2.1rem;height:2.1rem;border-radius:50%;display:grid;place-items:center">${h.pct}%</span>
        </div>
        <div class="info">
          <div class="t">${h.dir==='e2j'?'英→意味':'意味→英'}・${h.total}問</div>
          <div class="d">${fmtDate(h.date)}</div>
        </div>
        <div class="sc">${h.score}/${h.total}</div>
      </div>`;
    }).join('') : '<div class="empty">まだクイズ履歴がありません。<br>クイズに挑戦してみましょう。</div>'}

    ${quizHist.length ? '<button class="linkbtn" id="clearHist" style="display:block;margin:.6rem auto 0">クイズ履歴を消去</button>' : ''}

    <div class="sec-title">自分の単語をインポート（この端末だけに保存）</div>
    <div class="panel" style="padding:1rem">
      <p class="lead" style="margin:0 0 .8rem">
        お手持ちの教材から<b>自分で作成したCSV/エクセル</b>の単語データを読み込めます。
        読み込んだデータは<b>このブラウザ内だけ</b>に保存され、ネット上には公開・送信されません。
      </p>
      <div style="font-size:.78rem;color:var(--sub);background:var(--bg);border-radius:9px;padding:.6rem .75rem;margin-bottom:.8rem;line-height:1.7">
        <b>列の順番</b>（1行目の見出し行は任意）：<br>
        <code>単語, 発音記号, 品詞, 自他, 意味, 例文, 例文訳, レベル, カテゴリ</code><br>
        ・必須は「単語」と「意味」だけ。あとは空でOK<br>
        ・品詞＝名詞/動詞/形容詞/副詞/前置詞/接続詞/熟語<br>
        ・自他＝他/自/自他（動詞のみ）　レベル＝600/730/860/990
      </div>
      <button class="btn-ghost" id="dlTemplate" style="margin:0 0 .7rem">CSVテンプレートをダウンロード</button>
      <textarea id="csvBox" placeholder="ここにCSV/エクセルのセルを貼り付け（タブ区切りも可）&#10;例：&#10;abundant,/əˈbʌndənt/,形容詞,,豊富な,The region has abundant resources.,その地域は資源が豊富だ。,860,頻出形容詞"
        style="width:100%;min-height:110px;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font-family:ui-monospace,monospace;font-size:.82rem;padding:.6rem;resize:vertical"></textarea>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem">
        <button class="btn-primary" id="importText" style="flex:1;margin:0;min-width:130px">貼り付けた内容を追加</button>
        <label class="btn-ghost" style="flex:1;margin:0;text-align:center;min-width:130px;cursor:pointer">
          ファイルを選択
          <input type="file" id="importFile" accept=".csv,.tsv,.txt" hidden>
        </label>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.8rem;font-size:.8rem;color:var(--sub)">
        <span>登録済みマイ単語：<b>${userWords.length}</b> 語</span>
        <span>
          ${userWords.length ? '<button class="linkbtn" id="exportUser" style="color:var(--blue)">CSV書き出し</button>' : ''}
          ${userWords.length ? '<button class="linkbtn" id="clearUser">すべて削除</button>' : ''}
        </span>
      </div>
    </div>

    <div class="sec-title">データ管理</div>
    <button class="btn-ghost" id="resetKnown">「覚えた」をすべてリセット</button>
    <button class="btn-ghost" id="resetWeak" style="margin-top:.5rem">「覚えてない」をすべてリセット</button>

    <p class="note">
      学習データ（覚えた単語・クイズ履歴・マイ単語）は、<b>このブラウザ内にのみ</b>保存されます。<br>
      端末やブラウザを変えると引き継がれません（マイ単語はCSV書き出しでバックアップ・移行できます）。<br><br>
      ※ 組み込みの語彙はTOEIC頻出の一般語を独自に編集した学習用データで、特定の市販書籍を複製したものではありません。<br>
      インポート機能で追加した単語はあなた自身が用意したデータであり、この端末内での私的利用のためのものです。
    </p>`;

  const c = document.getElementById('clearHist');
  if (c) c.addEventListener('click', () => {
    if (confirm('クイズ履歴をすべて消去しますか？')){ quizHist=[]; save(LS.quiz, quizHist); renderStats(); toast('履歴を消去しました'); }
  });
  document.getElementById('resetKnown').addEventListener('click', () => {
    if (confirm('「覚えた」の記録をすべてリセットしますか？')){ known=new Set(); save(LS.known,[]); renderList(); renderStats(); toast('リセットしました'); }
  });
  document.getElementById('resetWeak').addEventListener('click', () => {
    if (confirm('「覚えてない」の記録をすべてリセットしますか？')){ weak=new Set(); save(LS.weak,[]); renderList(); renderStats(); toast('リセットしました'); }
  });

  // --- インポート関連 ---
  document.getElementById('dlTemplate').addEventListener('click', downloadTemplate);
  document.getElementById('importText').addEventListener('click', () => {
    const txt = document.getElementById('csvBox').value;
    doImport(txt);
  });
  document.getElementById('importFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result));
    reader.readAsText(f, 'utf-8');
  });
  const ex = document.getElementById('exportUser');
  if (ex) ex.addEventListener('click', exportUserWords);
  const cu = document.getElementById('clearUser');
  if (cu) cu.addEventListener('click', () => {
    if (confirm('インポートしたマイ単語をすべて削除しますか？')){
      userWords = []; save(LS.user, userWords); rebuildCatalog();
      renderCats(); renderList(); renderStats(); toast('マイ単語を削除しました');
    }
  });
}

/* ============================================================
   CSV / TSV インポート
   ============================================================ */
const POS_MAP = { '名詞':'noun','名':'noun','動詞':'verb','動':'verb','形容詞':'adj','形':'adj','副詞':'adv','副':'adv','前置詞':'prep','前':'prep','接続詞':'conj','接':'conj','熟語':'phrase','句':'phrase',
  noun:'noun', verb:'verb', adj:'adj', adjective:'adj', adv:'adv', adverb:'adv', prep:'prep', conj:'conj', phrase:'phrase' };
const VT_MAP = { '他':'t','他動詞':'t','vt':'t','t':'t','自':'i','自動詞':'i','vi':'i','i':'i','自他':'ti','両方':'ti','ti':'ti' };

// 1行をフィールド配列に分解（"..."引用対応、区切りは , か tab を自動判定）
function parseLine(line, delim){
  const out = []; let cur = ''; let q = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (q){
      if (ch === '"'){ if (line[i+1]==='"'){ cur+='"'; i++; } else q=false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === delim){ out.push(cur); cur=''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function doImport(text){
  if (!text || !text.trim()){ toast('データが空です'); return; }
  const rawLines = text.replace(/\r/g,'').split('\n').filter(l => l.trim().length);
  if (!rawLines.length){ toast('データが空です'); return; }

  const delim = rawLines[0].includes('\t') ? '\t' : ',';
  const added = [];
  rawLines.forEach((line, idx) => {
    const c = parseLine(line, delim);
    // 見出し行らしき最初の行はスキップ
    if (idx === 0 && /単語|word/i.test(c[0]) && /意味|mean|ja/i.test((c[4]||''))) return;
    const word = (c[0]||'').trim();
    const ja   = (c[4]||'').trim();
    if (!word || !ja) return;           // 必須欠けはスキップ
    if (/^[ぁ-んァ-ン一-龥]/.test(word)) return; // 単語列が日本語なら誤形式としてスキップ
    added.push({
      word,
      ipa:  (c[1]||'').trim(),
      pos:  POS_MAP[(c[2]||'').trim()] || 'noun',
      vt:   VT_MAP[(c[3]||'').trim()] || '',
      ja,
      ex:   (c[5]||'').trim(),
      exJa: (c[6]||'').trim(),
      level: (()=>{ const n=parseInt((c[7]||'').replace(/[^0-9]/g,''),10); return [600,730,860,990].includes(n)?n:600; })(),
      cat:  (c[8]||'').trim() || 'マイ単語',
    });
  });

  if (!added.length){ toast('取り込める行がありませんでした（形式をご確認ください）'); return; }
  userWords = userWords.concat(added);
  save(LS.user, userWords);
  rebuildCatalog();
  renderCats(); renderList(); renderStats();
  toast(`${added.length}語を追加しました（計${userWords.length}語）`);
}

function csvEscape(v){ v = String(v==null?'':v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }

function downloadCSV(filename, rows){
  const bom = '﻿';
  const csv = bom + rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function downloadTemplate(){
  downloadCSV('単語帳テンプレート.csv', [
    ['単語','発音記号','品詞','自他','意味','例文','例文訳','レベル','カテゴリ'],
    ['abundant','/əˈbʌndənt/','形容詞','','豊富な','The region has abundant resources.','その地域は資源が豊富だ。','860','頻出形容詞'],
    ['comply','/kəmˈplaɪ/','動詞','自','（規則に）従う','You must comply with the rules.','規則に従わなければならない。','730','ビジネス'],
  ]);
  toast('テンプレートを書き出しました');
}

function exportUserWords(){
  const rows = [['単語','発音記号','品詞','自他','意味','例文','例文訳','レベル','カテゴリ']];
  const posInv = { noun:'名詞', verb:'動詞', adj:'形容詞', adv:'副詞', prep:'前置詞', conj:'接続詞', phrase:'熟語' };
  const vtInv = { t:'他', i:'自', ti:'自他' };
  userWords.forEach(w => rows.push([w.word,w.ipa,posInv[w.pos]||w.pos,vtInv[w.vt]||'',w.ja,w.ex,w.exJa,w.level,w.cat]));
  downloadCSV('マイ単語.csv', rows);
  toast('マイ単語を書き出しました');
}

/* ============================================================
   初期化
   ============================================================ */
// 保存済みの絞り込み状態を UI に反映（リロード後も選択を維持）
(function restoreFilterUI(){
  document.querySelectorAll('#levelTabs .tab').forEach(t =>
    t.classList.toggle('on', t.dataset.level === filterLevel));
  const box = document.getElementById('search');
  if (box && searchQ) box.value = searchQ;
})();
renderCats();
renderList();
applyHideMode();
// レイアウト確定後にスクロール位置を復元（フォント読み込みの再配置も考慮して二段構え）
requestAnimationFrame(restoreScrollAnchor);
setTimeout(restoreScrollAnchor, 300);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(restoreScrollAnchor);
