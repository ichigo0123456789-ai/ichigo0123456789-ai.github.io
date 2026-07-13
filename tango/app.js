/* ============================================================
   金のフレーズ風 単語帳  —  アプリロジック
   - 音声   : Web Speech API (SpeechSynthesis) で英語を読み上げ
   - 履歴   : localStorage に「覚えた単語」「クイズ結果」を保存
   ============================================================ */
'use strict';

/* ---------- ストレージ ---------- */
const LS = {
  known:  'tango_known_v1',      // 覚えた単語ID配列
  quiz:   'tango_quiz_hist_v1',  // クイズ履歴
  user:   'tango_user_words_v1', // ユーザーがインポートした単語（この端末のみ）
};
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let known = new Set(load(LS.known, []));
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

/* ---------- 状態 ---------- */
let filterLevel = 'all';
let filterCat = 'all';
let searchQ = '';

/* ---------- 音声 ---------- */
let enVoice = null;
function pickVoice(){
  const vs = speechSynthesis.getVoices();
  enVoice = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Samantha|Natural/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang))
         || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window){
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
let speaking = null;
function speak(text, btn){
  if (!('speechSynthesis' in window)){ toast('この端末は音声に対応していません'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = 0.92; u.pitch = 1;
  if (enVoice) u.voice = enVoice;
  if (btn){
    if (speaking) speaking.classList.remove('playing');
    btn.classList.add('playing'); speaking = btn;
    u.onend = u.onerror = () => { btn.classList.remove('playing'); if (speaking===btn) speaking=null; };
  }
  speechSynthesis.speak(u);
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
const VT_JA  = { t:'他動詞', i:'自動詞', ti:'自/他動詞' };

/* ============================================================
   単語帳リスト描画
   ============================================================ */
function filteredWords(){
  return CATALOG.filter(w => {
    if (filterLevel === 'known'   && !known.has(w.id)) return false;
    if (filterLevel === 'unknown' &&  known.has(w.id)) return false;
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
    `${items.length}語　（覚えた ${known.size} / 全${CATALOG.length}語）`;

  if (!items.length){
    list.innerHTML = '<div class="empty">該当する単語がありません。</div>';
    return;
  }
  list.innerHTML = items.map(w => {
    const isKnown = known.has(w.id);
    const vt = w.pos === 'verb' && w.vt ? `<span class="badge b-vt">${VT_JA[w.vt]}</span>` : '';
    return `
    <article class="card ${isKnown?'known':''}" data-id="${w.id}">
      <div class="head">
        <div class="no">${w.no}</div>
        <div class="core">
          <div class="wordline">
            <span class="en">${esc(w.word)}</span>
            <span class="ipa">${esc(w.ipa||'')}</span>
          </div>
          <div class="badges">
            <span class="badge b-pos">${POS_JA[w.pos]||w.pos}</span>
            ${vt}
            <span class="badge b-lv">${w.level}点</span>
            ${w.cat?`<span class="badge b-cat">${esc(w.cat)}</span>`:''}
          </div>
          <p class="ja">${esc(w.ja)}</p>
          ${w.ex ? `<div class="ex" hidden>
            <span class="en2">${esc(w.ex)}</span>
            <span class="ja2">${esc(w.exJa||'')}</span>
          </div>` : ''}
          <div class="actions">
            <button class="iconbtn" data-act="play" title="音声を再生" aria-label="音声を再生">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.7 6.4 8.3H3v7.4h3.4L11 19.3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
            </button>
            <button class="knowbtn ${isKnown?'on':''}" data-act="know">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              ${isKnown?'覚えた':'覚えた'}
            </button>
            ${w.ex ? `<button class="expandbtn" data-act="expand">例文
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>` : ''}
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}

/* リストのクリック（イベント委譲） */
document.getElementById('list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const id = +card.dataset.id;
  const w = CATALOG.find(x => x.id === id);
  const act = btn.dataset.act;

  if (act === 'play'){ speak(w.word, btn); }
  else if (act === 'know'){
    if (known.has(id)) known.delete(id); else { known.add(id); toast('覚えたに追加しました'); }
    save(LS.known, [...known]);
    card.classList.toggle('known', known.has(id));
    btn.classList.toggle('on', known.has(id));
    document.getElementById('count').textContent =
      `${filteredWords().length}語　（覚えた ${known.size} / 全${CATALOG.length}語）`;
    if (filterLevel === 'known' || filterLevel === 'unknown') renderList();
  }
  else if (act === 'expand'){
    const ex = card.querySelector('.ex');
    ex.hidden = !ex.hidden;
    card.classList.toggle('open', !ex.hidden);
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
  filterCat = c.dataset.cat; renderCats(); renderList();
});

/* レベルタブ */
document.getElementById('levelTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  filterLevel = t.dataset.level;
  document.querySelectorAll('#levelTabs .tab').forEach(x => x.classList.toggle('on', x===t));
  renderList();
});

/* 検索 */
document.getElementById('search').addEventListener('input', e => {
  searchQ = e.target.value.trim(); renderList();
});

/* ============================================================
   ビュー切り替え（ボトムナビ）
   ============================================================ */
document.querySelector('.nav .in').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  const v = b.dataset.view;
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('on', x===b));
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on'));
  document.getElementById('view-'+v).classList.add('on');
  window.scrollTo(0,0);
  if (v === 'quiz') renderQuizSetup();
  if (v === 'history') renderStats();
});

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

  if (pool.length < 4){ toast('出題できる単語が足りません（4語以上必要）'); return; }
  const items = shuffle(pool).slice(0, Math.min(n, pool.length));
  quiz = { items, i:0, correct:0, dir, results:[] };
  renderQuestion();
}

function renderQuestion(){
  const area = document.getElementById('quizArea');
  const q = quiz.items[quiz.i];
  const isE2J = quiz.dir === 'e2j';

  // 選択肢（正解 + 同じ形式のダミー3つ）
  const distractPool = CATALOG.filter(w => w.id !== q.id);
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
          ? `<div class="en">${esc(q.word)}</div><div class="ipa">${esc(q.ipa||'')}</div>`
          : `<div class="ja">${esc(q.ja)}</div>`}
      </div>
      ${isE2J ? `<div class="q-audio"><button id="qPlay" aria-label="音声"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.7 6.4 8.3H3v7.4h3.4L11 19.3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button></div>` : ''}
      <div class="opts" id="qOpts">
        ${opts.map(o => `<button class="opt" data-id="${o.id}">${esc(label(o))}</button>`).join('')}
      </div>
    </div>`;

  if (isE2J){
    const pb = document.getElementById('qPlay');
    speak(q.word); // 出題時に自動再生
    pb.addEventListener('click', () => speak(q.word, null));
  }

  document.getElementById('qOpts').addEventListener('click', e => {
    const b = e.target.closest('.opt'); if (!b) return;
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
  }, { once:true });
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
            <span class="m">${esc(r.ja)}</span>
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
      <div class="stat"><div class="n">${quizHist.length}</div><div class="l">クイズ回数</div></div>
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
    if (confirm('「覚えた」の記録をすべてリセットしますか？')){ known=new Set(); save(LS.known,[]); renderStats(); toast('リセットしました'); }
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
renderCats();
renderList();
