/* ============================================================
   座席オートリザーブ — UI
   ------------------------------------------------------------
   プランの編集・座席選択・実行・カレンダー連携。
   保存先はこの端末の localStorage のみで、外部への送信は行わない。
   ============================================================ */

(function () {
  'use strict';

  var D = window.CINEMA_DATA;
  var CE = window.CinemaEngine;
  var CR = window.CinemaRunner;
  var CS = window.CinemaSpeed;

  var LS_PLANS = 'cinema.plans.v1';
  var LS_PROFILE = 'cinema.profile.v1';
  var LS_EYE = 'cinema.eye.v1';   // 利き目（個人情報ではないので「この端末に保存する」の対象外で常時保存）

  var $ = function (id) { return document.getElementById(id); };

  /* ---- 状態 -------------------------------------------------------- */
  var S = {
    plans: [],
    plan: null,        /* 編集中のプラン */
    pick: [],          /* 候補として組み立て中の座席 */
    runner: null,
    adapter: null,
    clock: null,       /* 実行に使った時計。リハーサルでは早送りされている */
    rehearsal: false,
    liveMap: null,     /* 実行中に取得した座席状況 */
    logs: [],
    result: null,
    sync: null,        /* CinemaSpeed.TimeSync */
    visWatch: null,
    profile: { save: false, name: '', tel: '', mail: '' }
  };

  /* ---- 小物 -------------------------------------------------------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var toastEl = null;
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** Date -> "YYYY-MM-DDTHH:MM"（datetime-local 用のローカル表現） */
  function toLocalInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 上映日+開映時刻 -> Date */
  function showDate(plan) {
    if (!plan.date || !plan.showtime) return null;
    var p = plan.date.split('-'), t = plan.showtime.split(':');
    return new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1], 0, 0);
  }

  function onSaleMs(plan) {
    return plan.onSaleAt ? new Date(plan.onSaleAt).getTime() : NaN;
  }

  /* ---- 保存 -------------------------------------------------------- */

  function loadStore() {
    try {
      var raw = localStorage.getItem(LS_PLANS);
      S.plans = raw ? JSON.parse(raw) : [];
    } catch (e) { S.plans = []; }
    try {
      var p = localStorage.getItem(LS_PROFILE);
      if (p) S.profile = JSON.parse(p);
    } catch (e) {}
  }

  function savePlans() {
    try { localStorage.setItem(LS_PLANS, JSON.stringify(S.plans)); }
    catch (e) { toast('保存できませんでした（保存領域がいっぱいの可能性）'); }
  }

  function saveProfile() {
    /* 「この端末に保存する」が OFF のときは、書き込まずに既存も消す。
       チェックを外した瞬間に痕跡が残らないようにするため。 */
    if (!S.profile.save) { localStorage.removeItem(LS_PROFILE); return; }
    try { localStorage.setItem(LS_PROFILE, JSON.stringify(S.profile)); } catch (e) {}
  }

  /* ---- プランの生成 ------------------------------------------------ */

  function blankPlan() {
    var chain = Object.keys(D.chains)[0];
    var theater = D.theaters.filter(function (t) { return t.chain === chain; })[0];
    var d = new Date();
    d.setDate(d.getDate() + 7);
    return {
      id: uid(),
      chain: chain,
      theaterId: theater.id,
      /* ドルビーシネマのシアター4を既定に。いちばん競争になる回を想定している。 */
      screenId: (theater.screens.filter(function (x) { return x.format; })[0] || theater.screens[0]).id,
      title: '',
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      showtime: '19:20',
      runtime: 120,
      count: 2,
      tickets: { general: 2 },
      onSaleAt: '',
      candidates: [],
      strategy: {
        pollIntervalMs: 1000, preconnectSec: 20, deadlineSec: 180,
        fallbackAny: false, holdFirst: true
      },
      mock: { congestion: 'normal', seed: 'rehearsal-1', speed: 30 }
    };
  }

  /** チェーンの慣例から発売開始日時を計算する */
  function autoOnSale(plan) {
    var sd = showDate(plan);
    if (!sd) return '';
    var ch = D.chains[plan.chain];
    var rule = ch.memberOnSaleRule || ch.onSaleRule; // 会員先行があればそちらを既定に（本ツールは会員利用前提）
    var d = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate());
    d.setDate(d.getDate() - rule.daysBefore);
    var t = rule.time.split(':');
    d.setHours(+t[0], +t[1], 0, 0);
    return toLocalInput(d);
  }

  /* ---- ビュー切り替え ---------------------------------------------- */

  function showView(name) {
    ['theater', 'plan', 'seats', 'run', 'result', 'privacy'].forEach(function (v) {
      $('view-' + v).classList.toggle('on', v === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.classList.toggle('on', b.dataset.view === name);
    });
    if (name === 'theater') renderTheaterPicker();
    if (name === 'plan') {
      renderPlanSelbar();
      if (!scheduleDate) scheduleDate = S.plan.date || dateStr(new Date());
      renderDateStrip();
      renderSchedule();
    }
    if (name === 'seats') { renderSeatEditor(); renderRulesBox(); loadRunnerSeatMap(); }
    if (name === 'run') { renderLiveMap(); updateRunPrecheck(); autoSync(); }
    if (name === 'privacy') renderChecklist();
    window.scrollTo(0, 0);
  }

  /* ---- ① 劇場選択 --------------------------------------------------

     全国マップは対応館が首都圏に密集して重なるため廃止。
     エリア（地方）チップ＋チェーンチップで絞り込み、サブエリア（池袋/新宿…）
     ごとにカードでまとめる。館が増えてもそのまま並ぶ構造。 */

  var theaterQuery = '';
  var areaFilter = 'all';   /* 地方: all / 東京 / 神奈川 / 関西 … */
  var chainFilter = 'all';  /* チェーンキー */

  var CHAIN_SHORT = { tjoy: 'T・ジョイ', c109: '109シネマズ', cinecitta: 'チネチッタ', sunshine: 'サンシャイン', eigaland: '映画ランド', toho: 'TOHO' };
  var CHAIN_COLOR = { tjoy: '#0b6fb8', c109: '#e8541e', cinecitta: '#7b2ff7', sunshine: '#c98a06', eigaland: '#1f9d63', toho: '#c8102e' };

  /* 都道府県から地方ブロックを求める（エリア絞り込みの単位） */
  /* 並び順（地理順）。ここに載っていないものは末尾＋五十音。 */
  var REGION_ORDER = ['関東', '関西', '東海', '北海道', '東北', '中部', '中国', '四国', '九州・沖縄', 'その他'];
  var PREF_ORDER = ['東京', '神奈川', '千葉', '埼玉', '茨城', '栃木', '群馬', '京都', '大阪', '兵庫', '奈良', '滋賀', '愛知', '静岡', '北海道', '福岡'];
  var SUBAREA_ORDER = ['池袋', '新宿', '渋谷', '日比谷', '六本木', '上野', '横浜', '川崎', '京都', '梅田', '大阪', '難波'];
  function orderBy(arr) {
    return function (a, b) {
      var ia = arr.indexOf(a), ib = arr.indexOf(b);
      if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      return ia - ib || a.localeCompare(b);
    };
  }

  /* 地方（関東・関西…）。エリア絞り込みチップの単位。 */
  function regionOf(t) {
    var p = t.pref || '';
    if (/東京|神奈川|千葉|埼玉|茨城|栃木|群馬/.test(p)) return '関東';
    if (/京都|大阪|兵庫|奈良|滋賀|和歌山/.test(p)) return '関西';
    if (/愛知|岐阜|三重|静岡/.test(p)) return '東海';
    if (/北海道/.test(p)) return '北海道';
    if (/福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄/.test(p)) return '九州・沖縄';
    return 'その他';
  }
  /* 都県（表示用に 都/府/県 を落とす）。地方の中のセクション見出し。 */
  function prefOf(t) { return String(t.pref || 'その他').replace(/[都道府県]$/, ''); }

  /* 街レベルの小エリア（カードの見出し）。名前・エリア・駅から拾う。 */
  var SUBAREA_KW = ['池袋', '新宿', '渋谷', '日比谷', '六本木', '横浜', '川崎', '京都', '梅田', '大阪', '難波'];
  function subareaOf(t) {
    var s = [t.area || '', t.station || '', t.name || ''].join(' ');
    for (var i = 0; i < SUBAREA_KW.length; i++) if (s.indexOf(SUBAREA_KW[i]) >= 0) return SUBAREA_KW[i];
    var head = (t.area || '').split('/')[0].trim();
    return head || regionOf(t);
  }

  function theaterMatches(t, q) {
    if (!q) return true;
    var hay = [t.name, t.area, t.pref || '', t.station || '', t.address || ''].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return !w || hay.indexOf(w) >= 0; });
  }

  function selectTheater(id) {
    if (S.plan.theaterId !== id) {
      S.plan.theaterId = id;
      var t = D.theater(id);
      if (t) {
        S.plan.chain = t.chain;
        S.plan.screenId = t.screens[0].id;
      }
      /* 劇場が変われば座席の意味が変わる */
      S.plan.candidates = []; S.pick = [];
    }
    /* 隠しフォーム（readForm がここから読む）へ同期。これをしないと
       タブ切替時の readForm が古い #f-theater 値で theaterId を上書きしてしまう。 */
    fillTheaters(S.plan.theaterId);
    fillScreens(S.plan.theaterId, S.plan.screenId);
    renderTheaterPicker();
    $('btn-to-plan').disabled = false;
  }

  /* エリア/チェーンの絞り込みチップを描く */
  function renderChips(el, items, active, onPick) {
    if (!el) return;
    el.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (it.key === active ? ' on' : '');
      if (it.color) b.style.setProperty('--chip-accent', it.color);
      b.innerHTML = esc(it.label) + (it.count != null ? ' <span class="chip-n">' + it.count + '</span>' : '');
      b.addEventListener('click', function () { onPick(it.key); });
      el.appendChild(b);
    });
  }

  function renderTheaterPicker() {
    var all = D.theaters;

    /* --- エリアチップ（件数の多い地方順、すべて先頭） --- */
    var regionCount = {};
    all.forEach(function (t) { var r = regionOf(t); regionCount[r] = (regionCount[r] || 0) + 1; });
    var regions = Object.keys(regionCount).sort(orderBy(REGION_ORDER));
    var areaItems = [{ key: 'all', label: 'すべて', count: all.length }].concat(
      regions.map(function (r) { return { key: r, label: r, count: regionCount[r] }; }));
    renderChips($('area-chips'), areaItems, areaFilter, function (k) { areaFilter = k; renderTheaterPicker(); });

    /* --- チェーンチップ（現在のエリア絞り込み下の件数） --- */
    var inArea = all.filter(function (t) { return areaFilter === 'all' || regionOf(t) === areaFilter; });
    var chainCount = {};
    inArea.forEach(function (t) { chainCount[t.chain] = (chainCount[t.chain] || 0) + 1; });
    var chainKeys = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; });
    var chainItems = [{ key: 'all', label: 'すべて', count: inArea.length }].concat(
      chainKeys.map(function (c) { return { key: c, label: CHAIN_SHORT[c] || (D.chains[c] && D.chains[c].name) || c, count: chainCount[c], color: CHAIN_COLOR[c] }; }));
    if (chainFilter !== 'all' && !chainCount[chainFilter]) chainFilter = 'all';
    renderChips($('chain-chips'), chainItems, chainFilter, function (k) { chainFilter = k; renderTheaterPicker(); });

    /* --- 絞り込み結果を 都県 › サブエリア の階層でカード表示（地理順） --- */
    var groups = $('theater-groups');
    groups.innerHTML = '';
    var shown = all.filter(function (t) {
      return theaterMatches(t, theaterQuery)
        && (areaFilter === 'all' || regionOf(t) === areaFilter)
        && (chainFilter === 'all' || t.chain === chainFilter);
    });

    if (!shown.length) {
      groups.innerHTML = '<div class="theater-empty">条件に合う対応劇場がありません。<br>エリア・チェーンの絞り込みを「すべて」に戻すか、検索語を変えてください。</div>';
      $('btn-to-plan').disabled = !S.plan.theaterId;
      return;
    }

    var byPref = {};
    shown.forEach(function (t) { var pf = prefOf(t); (byPref[pf] = byPref[pf] || []).push(t); });
    Object.keys(byPref).sort(orderBy(PREF_ORDER)).forEach(function (pf) {
      var list = byPref[pf];
      var section = document.createElement('div');
      section.className = 'tpref';
      var ph = document.createElement('div');
      ph.className = 'tpref-head';
      ph.innerHTML = '<span class="tpref-region">' + esc(regionOf(list[0])) + '</span>' +
        '<span class="tpref-name">' + esc(pf) + '</span><span class="tpref-n">' + list.length + '館</span>';
      section.appendChild(ph);

      var bySub = {};
      list.forEach(function (t) { var sa = subareaOf(t); (bySub[sa] = bySub[sa] || []).push(t); });
      Object.keys(bySub).sort(orderBy(SUBAREA_ORDER)).forEach(function (sub) {
        var wrap = document.createElement('div');
        wrap.className = 'tgroup';
        var head = document.createElement('div');
        head.className = 'tgroup-head';
        head.innerHTML = '<span class="tgroup-name">' + esc(sub) + '</span><span class="tgroup-n">' + bySub[sub].length + '館</span>';
        wrap.appendChild(head);
        var cards = document.createElement('div');
        cards.className = 'theater-cards';
        bySub[sub].forEach(function (t) {
          var on = t.id === S.plan.theaterId;
          var color = CHAIN_COLOR[t.chain] || 'var(--sub)';
          var scr = (t.screens && t.screens.length) ? t.screens.length + 'スクリーン' : '';
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'theater-card' + (on ? ' on' : '');
          b.innerHTML =
            '<span class="tc-top"><span class="tc-badge" style="background:' + color + '">' + esc(CHAIN_SHORT[t.chain] || D.chains[t.chain].name) + '</span>' +
            (on ? '<span class="tc-check">✓ 選択中</span>' : '') + '</span>' +
            '<span class="tc-name">' + esc(t.name) + '</span>' +
            '<span class="tc-meta">' + esc(t.station || t.area || '') + (scr ? ' ・ ' + scr : '') + '</span>';
          b.addEventListener('click', function () { selectTheater(t.id); });
          cards.appendChild(b);
        });
        wrap.appendChild(cards);
        section.appendChild(wrap);
      });
      groups.appendChild(section);
    });

    $('btn-to-plan').disabled = !S.plan.theaterId;
  }

  /* ---- ② 選択サマリー ---------------------------------------------- */

  function renderPlanSelbar() {
    var bar = $('plan-selbar');
    if (!bar) return;
    var t = D.theater(S.plan.theaterId);
    bar.innerHTML = '';
    var chip = document.createElement('span');
    if (t) {
      chip.className = 'sel-chip';
      chip.innerHTML = '<span class="sc-label">映画館</span><b>' + esc(t.name) + '</b>';
    } else {
      chip.className = 'sel-chip empty';
      chip.textContent = '映画館が未選択です（手順1へ）';
    }
    bar.appendChild(chip);

    var chip2 = document.createElement('span');
    if (S.plan.title && S.plan.date && S.plan.showtime) {
      chip2.className = 'sel-chip';
      chip2.innerHTML = '<span class="sc-label">上映回</span><b>' +
        esc(S.plan.title + '　' + S.plan.date + ' ' + S.plan.showtime) + '</b>';
    } else {
      chip2.className = 'sel-chip empty';
      chip2.textContent = '作品と時間帯が未選択です';
    }
    bar.appendChild(chip2);
  }

  /* ---- ② 番組表 ----------------------------------------------------

     日付タブ + 作品ごとの時間帯ボタン。選ぶと従来のフォーム項目
     （タイトル・日付・時刻・スクリーン・上映時間）へ同期するので、
     以降の処理（readForm / 実行 / カレンダー）は変更なしで動く。 */

  var scheduleDate = null;   /* 表示中の日付 'YYYY-MM-DD' */

  function dateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderDateStrip() {
    var strip = $('date-strip');
    strip.innerHTML = '';
    var today = new Date();
    for (var i = 0; i < 14; i++) {
      (function (i) {
        var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        var ds = dateStr(d);
        var dow = d.getDay();
        var dowLabel = i === 0 ? '今日' : (i === 1 ? '明日' : '日月火水木金土'[dow]);
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'date-chip' + (ds === scheduleDate ? ' on' : '') + (i === 0 ? ' today' : '');
        chip.innerHTML =
          '<span class="dc-dow' + (dow === 0 ? ' dc-sun' : dow === 6 ? ' dc-sat' : '') + '">' + dowLabel + '</span>' +
          '<span class="dc-day' + (dow === 0 ? ' dc-sun' : dow === 6 ? ' dc-sat' : '') + '">' +
            (d.getMonth() + 1) + '/' + d.getDate() + '</span>';
        chip.addEventListener('click', function () {
          scheduleDate = ds;
          renderDateStrip();
          renderSchedule();
        });
        strip.appendChild(chip);
      })(i);
    }
  }

  /** いま選ばれている上映回かどうか */
  function isSelectedShow(movie, show) {
    return S.plan.title === movie.title &&
      S.plan.date === scheduleDate &&
      S.plan.showtime === show.time &&
      S.plan.screenId === show.screenId;
  }

  function selectShow(movie, show) {
    S.plan.title = movie.title;
    S.plan.date = scheduleDate;
    S.plan.showtime = show.time;
    S.plan.screenId = show.screenId;
    S.plan.runtime = movie.runtime;
    /* スクリーンが変われば座席の意味が変わる */
    S.plan.candidates = []; S.pick = [];

    /* 隠しフォームへ同期（readForm がここから読む） */
    $('f-title').value = movie.title;
    $('f-date').value = S.plan.date;
    $('f-time').value = show.time;
    fillScreens(S.plan.theaterId, show.screenId);
    $('f-screen').value = show.screenId;
    $('f-runtime').value = movie.runtime;

    /* 発売開始日時も KINEZO の慣例から自動設定（手動変更は右のカードで可能） */
    var auto = autoOnSale(S.plan);
    if (auto) { S.plan.onSaleAt = auto; $('f-onsale').value = auto; }

    updateTicketSum();
    updateSeatContext();
    renderPlanSelbar();
    renderSchedule();
    tickCountdown();
    toast(movie.title + ' ' + show.time 
      + '（' + show.screenName + '）を選びました');
  }

  var STATUS_LABEL = {
    many: '<span class="st-mark st-many">◎</span>',
    few: '<span class="st-mark st-few">残りわずか</span>',
    soldout: '<span class="st-mark st-soldout">売切</span>',
    presale: '<span class="st-presale">発売前</span>'
  };

  /* ② 上映回の指定（手元 runner の実番組表から選ぶ）
     ------------------------------------------------------------
     静的サイトは各映画館の実番組表を安定取得できない（CORS）。そこで手元PCで
     runner の番組表サーバ（node runner/serve.js, 127.0.0.1:8790）を立て、ここから
     実際の上映回を取得してリスト表示する。runner が無ければ手動入力にフォールバック。 */

  var _lastSchedule = null;    /* 直近に取得した番組表（再描画用キャッシュ） */
  var _schedReq = 0;           /* 競合する非同期取得の識別（古い応答を捨てる） */

  function runnerBase() {
    var port = 8790;
    try { var pv = localStorage.getItem('runnerPort'); if (pv) port = parseInt(pv, 10) || 8790; } catch (e) {}
    return 'http://127.0.0.1:' + port;
  }

  function fetchJson(url, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, ms || 12000) : null;
    return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (to) clearTimeout(to);
        return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j; });
      })
      .catch(function (e) { if (to) clearTimeout(to); throw e; });
  }

  /* 一過性の失敗（タイムアウト/接続失敗＝サーバ起動直後など）は自動再試行する。
     サーバが返した本当のエラー（対象回なし等）は再試行せず即座に投げる。 */
  async function fetchJsonRetry(url, ms, tries) {
    tries = tries || 3;
    var lastErr;
    for (var i = 0; i < tries; i++) {
      try { return await fetchJson(url, ms); }
      catch (e) {
        lastErr = e;
        var transient = e && (e.name === 'AbortError' || /Failed to fetch|NetworkError|load failed|ERR_|timed out|Load failed/i.test(String(e.message)));
        if (!transient || i === tries - 1) throw e;
        await new Promise(function (r) { setTimeout(r, 350 + i * 350); });
      }
    }
    throw lastErr;
  }

  function fetchRunnerSchedule(key, date) {
    return fetchJsonRetry(runnerBase() + '/schedule?theater=' + encodeURIComponent(key) + '&date=' + encodeURIComponent(date), 15000, 3);
  }

  /* runner 接続状態の帯表示 */
  function setRunnerStatus(state, err) {
    var el = $('runner-status');
    if (!el) return;
    if (state === 'ok') {
      el.hidden = false;
      el.className = 'runner-status ok';
      el.innerHTML = '<span class="rs-dot"></span>手元の runner に接続中（実番組表を表示しています）';
    } else if (state === 'checking') {
      el.hidden = false;
      el.className = 'runner-status checking';
      el.innerHTML = '<span class="rs-dot"></span>手元の runner を確認中…';
    } else if (state === 'down') {
      el.hidden = false;
      el.className = 'runner-status down';
      el.innerHTML =
        '<div class="rs-title">手元の runner が見つかりません</div>' +
        '<div class="rs-body">実際の上映回を出すには、ターミナルで次を起動してください：' +
        '<code>node runner/serve.js</code>（起動したまま）。起動後に「再試行」を押してください。</div>' +
        '<div class="rs-actions"><button class="btn sm" id="rs-retry">再試行</button>' +
        '<button class="btn ghost sm" id="rs-manual">runner を使わず手動で入力</button></div>';
      var t = D.theater(S.plan.theaterId);
      var rr = $('rs-retry'); if (rr) rr.addEventListener('click', function () { if (t) loadSchedule(t, scheduleDate); });
      var rm = $('rs-manual'); if (rm) rm.addEventListener('click', function () { if (t) renderManualFallback(t); });
    } else {
      el.hidden = true; el.innerHTML = '';
    }
  }

  function renderSchedule() {
    var wrap = $('schedule-list');
    var t = D.theater(S.plan.theaterId);
    if (!t) {
      setRunnerStatus('');
      wrap.innerHTML = '<div class="empty">先に映画館を選んでください（手順1）。</div>';
      return;
    }
    if (S.plan.date !== scheduleDate) { S.plan.date = scheduleDate; $('f-date').value = scheduleDate; }
    loadSchedule(t, scheduleDate);
  }

  async function loadSchedule(t, date) {
    var key = t.runnerKey || 'yokohama';
    var reqId = ++_schedReq;
    setRunnerStatus('checking');
    $('schedule-list').innerHTML = '<div class="sched-loading"><span class="spin"></span> 手元の runner に ' +
      esc(t.name) + ' の上映回を問い合わせ中…</div>';
    try {
      var data = await fetchRunnerSchedule(key, date);
      if (reqId !== _schedReq) return;   /* 新しい取得が始まっていたら破棄 */
      _lastSchedule = data;
      setRunnerStatus('ok');
      renderScheduleList(t, data);
    } catch (e) {
      if (reqId !== _schedReq) return;
      _lastSchedule = null;
      setRunnerStatus('down', e);
      renderManualFallback(t);
    }
  }

  /* 空席ラベル */
  function availLabel(show) {
    if (show.status === 'presale' || show.onSale === false) return '発売前';
    if (show.remaining != null) return show.remaining > 0 ? '残' + show.remaining : '満席';
    var st = show.status;
    if (st === 'X' || st === 'soldout') return '満席';
    if (st === 'W') return '窓口のみ';
    if (st === 'A' || st === 'many') return '空席';
    return '';
  }

  /* サブスクリーン情報（ポップオーバー）の中身 */
  function screenInfoHtml(t, movie, show) {
    var num = (String(show.screenName || show.screen || '').match(/\d+/) || [])[0];
    var siteScreen = num ? t.screens.filter(function (sc) { return (String(sc.name).match(/\d+/) || [])[0] === num; })[0] : null;
    var cap = (siteScreen && siteScreen.seats) || show.allSeats || null;
    var tags = (show.tags || []);
    var av = availLabel(show);
    return '<div class="screen-pop">' +
      '<div class="sp-name">' + esc(show.screenName || 'スクリーン') + '</div>' +
      (tags.length ? '<div class="sp-tags">' + tags.map(function (x) { return '<span class="tg">' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="sp-cap">' + (cap ? '座席数 ' + cap + '席' : '座席数 —') + (av ? ' ／ ' + esc(av) : '') + '</div>' +
      (siteScreen && siteScreen.format ? '<div class="sp-fmt">' + esc(siteScreen.format) + '</div>' : '') +
      '<div class="sp-note">座席配置・マップは「座席を選ぶ」画面で確認・選択できます</div>' +
      '</div>';
  }

  function mapScreenId(t, show) {
    var num = (String(show.screenName || show.screen || '').match(/\d+/) || [])[0];
    if (num) {
      var hit = t.screens.filter(function (sc) { return (String(sc.name).match(/\d+/) || [])[0] === num; })[0];
      if (hit) return hit.id;
    }
    return (t.screens[0] || {}).id;
  }

  function isRunnerSelected(movie, show) {
    return S.plan.title === movie.title && S.plan.date === scheduleDate && S.plan.showtime === show.time;
  }

  function selectShowFromRunner(t, movie, show) {
    S.plan.title = movie.title;
    S.plan.date = scheduleDate;
    S.plan.showtime = show.time;
    S.plan.runtime = movie.runtime || S.plan.runtime || 120;
    var sid = mapScreenId(t, show);
    var changed = S.plan.screenId !== sid;
    S.plan.screenId = sid;
    S.plan.screenLabel = show.screenName || '';   /* runner の実スクリーン名（座席画面の表示に使う） */
    if (changed) { S.plan.candidates = []; S.pick = []; }
    $('f-title').value = movie.title; $('f-date').value = scheduleDate; $('f-time').value = show.time;
    fillScreens(S.plan.theaterId, sid); $('f-screen').value = sid; $('f-runtime').value = S.plan.runtime;
    var auto = autoOnSale(S.plan); if (auto) { S.plan.onSaleAt = auto; $('f-onsale').value = auto; }
    updateSeatContext(); renderPlanSelbar(); tickCountdown();
    if (_lastSchedule) renderScheduleList(t, _lastSchedule);
    toast(movie.title + ' ' + show.time + '（' + (show.screenName || '') + '）を選びました');
  }

  function renderScheduleList(t, data) {
    var wrap = $('schedule-list');
    wrap.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'sched-day';
    head.innerHTML = esc(scheduleDate.replace(/-/g, '/')) + ' ／ ' + esc(t.name) +
      ' <span class="sched-src">実番組表（runner取得）</span>';
    wrap.appendChild(head);

    var movies = (data.movies || []).slice().sort(function (a, b) {
      var ta = (a.shows[0] && a.shows[0].time) || '99:99', tb = (b.shows[0] && b.shows[0].time) || '99:99';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    if (!movies.length) {
      /* まだ発売前・番組表未公開の日（先の予約を仕込みたいケース）。手動入力で先回りできる。 */
      renderManualFallback(t, 'この日はまだ発売前、または番組表が未公開です。先の予約を仕込むには、作品名（一部でOK）と開映時刻を手入力してください。実行時に runner が最新の番組表と自動で突き合わせます（発売時刻に自動発火するよう「発売開始日時」も設定できます）。');
      return;
    }

    movies.forEach(function (m) {
      var block = document.createElement('div');
      block.className = 'sched-movie';
      var tagHtml = (m.tags || []).map(function (x) { return '<span class="tg tg-' + tagClass(x) + '">' + esc(x) + '</span>'; }).join('');
      var hd = document.createElement('div');
      hd.className = 'sm-head';
      hd.innerHTML = '<span class="sm-title">' + esc(m.title) + '</span>' + tagHtml +
        (m.runtime ? '<span class="sm-runtime">' + m.runtime + '分</span>' : '');
      block.appendChild(hd);

      var shows = document.createElement('div');
      shows.className = 'sm-shows';
      (m.shows || []).slice().sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; }).forEach(function (sh) {
        var on = isRunnerSelected(m, sh);
        var av = availLabel(sh);
        var full = av === '満席';
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'show-chip' + (on ? ' on' : '') + (full ? ' full' : '');
        chip.innerHTML =
          '<span class="sc-time">' + esc(sh.time || '--:--') + '</span>' +
          '<span class="sc-screen">' + esc(sh.screenName || 'スクリーン') +
            '<span class="sc-info" tabindex="0" role="button" aria-label="シアター情報">i' +
            screenInfoHtml(t, m, sh) + '</span></span>' +
          (av ? '<span class="sc-avail' + (full ? ' full' : '') + '">' + esc(av) + '</span>' : '');
        chip.addEventListener('click', function () { selectShowFromRunner(t, m, sh); });
        /* シアター情報アイコン: クリックで開閉（モバイル対応）。ホバーは CSS。 */
        var info = chip.querySelector('.sc-info');
        if (info) info.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var open = info.classList.contains('open');
          var all = wrap.querySelectorAll('.sc-info.open');
          for (var i = 0; i < all.length; i++) all[i].classList.remove('open');
          if (!open) info.classList.add('open');
        });
        shows.appendChild(chip);
      });
      block.appendChild(shows);
      wrap.appendChild(block);
    });
  }

  function tagClass(x) {
    if (/IMAX/.test(x)) return 'imax';
    if (/Dolby/.test(x)) return 'dolby';
    if (/4DX|MX4D|ScreenX|TCX/.test(x)) return 'motion';
    if (/字幕/.test(x)) return 'sub';
    if (/吹替/.test(x)) return 'dub';
    if (/3D/.test(x)) return 'threed';
    return 'gen';
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* runner が無い／その日がまだ発売前 のときのフォールバック（手動入力フォーム） */
  function renderManualFallback(t, note) {
    var wrap = $('schedule-list');
    wrap.innerHTML = '';
    if (note) wrap.appendChild(el('div', 'sched-note', note));
    if (S.plan.date !== scheduleDate) { S.plan.date = scheduleDate; $('f-date').value = scheduleDate; }
    var box = document.createElement('div');
    box.className = 'movie-block manual-show';
    box.innerHTML =
      '<div class="movie-head"><span class="movie-title">上映回を手動で指定</span>' +
      '<span class="movie-meta">' + esc(scheduleDate.replace(/-/g, '/')) + ' ／ ' + esc(t.name) + '</span></div>' +
      '<div class="row-2">' +
        '<div class="field"><label for="m-title">作品名（一部でOK・部分一致）</label>' +
        '<input id="m-title" type="text" placeholder="例：オークストリート" value="' + esc(S.plan.title || '') + '"></div>' +
        '<div class="field"><label for="m-time">開映時刻</label>' +
        '<input id="m-time" type="time" value="' + esc(S.plan.showtime || '') + '"></div>' +
      '</div>' +
      '<div class="row-2">' +
        '<div class="field"><label for="m-screen">スクリーン（この座席表で席を選びます）</label><select id="m-screen"></select></div>' +
        '<div class="field"><label for="m-runtime">上映時間（分・任意）</label>' +
        '<input id="m-runtime" type="number" min="30" max="300" value="' + (S.plan.runtime || 120) + '"></div>' +
      '</div>' +
      '<p class="hint">runner を起動すると、ここに実際の上映回リストが表示されます（<code>node runner/serve.js</code>）。' +
      '手動指定の場合、実行時に runner が劇場サイトの最新番組表と突き合わせます（<code>--dry</code> で実在確認）。</p>';
    wrap.appendChild(box);
    var sel = box.querySelector('#m-screen');
    t.screens.forEach(function (sc) {
      var o = document.createElement('option');
      o.value = sc.id;
      o.textContent = sc.name + (sc.format ? '（' + sc.format + '）' : '') + ' ' + sc.seats + '席';
      sel.appendChild(o);
    });
    if (S.plan.screenId && sel.querySelector('option[value="' + S.plan.screenId + '"]')) sel.value = S.plan.screenId;
    else S.plan.screenId = sel.value;
    function apply() {
      var title = box.querySelector('#m-title').value.trim();
      var time = box.querySelector('#m-time').value;
      var screenId = sel.value;
      var runtime = parseInt(box.querySelector('#m-runtime').value, 10) || 120;
      var screenChanged = S.plan.screenId !== screenId;
      S.plan.title = title; S.plan.date = scheduleDate; S.plan.showtime = time;
      S.plan.screenId = screenId; S.plan.runtime = runtime; S.plan.screenLabel = '';
      if (screenChanged) { S.plan.candidates = []; S.pick = []; }
      $('f-title').value = title; $('f-date').value = scheduleDate; $('f-time').value = time;
      fillScreens(S.plan.theaterId, screenId); $('f-screen').value = screenId; $('f-runtime').value = runtime;
      var auto = autoOnSale(S.plan);
      if (auto) { S.plan.onSaleAt = auto; $('f-onsale').value = auto; }
      updateTicketSum(); updateSeatContext(); renderPlanSelbar(); tickCountdown();
    }
    ['m-title', 'm-time', 'm-screen', 'm-runtime'].forEach(function (id) {
      box.querySelector('#' + id).addEventListener('change', apply);
    });
    box.querySelector('#m-title').addEventListener('input', apply);
    apply();
  }

  /* ---- フォーム ---------------------------------------------------- */

  function fillTheaters(selected) {
    var sel = $('f-theater');
    sel.innerHTML = '';
    D.theaters.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id; o.textContent = t.name + '（' + t.area + '）';
      sel.appendChild(o);
    });
    if (selected && sel.querySelector('option[value="' + selected + '"]')) sel.value = selected;
  }

  function fillScreens(theaterId, selected) {
    var sel = $('f-screen');
    sel.innerHTML = '';
    var t = D.theater(theaterId);
    if (!t) return;
    t.screens.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name + '（' + s.seats + '席' + (s.format ? ' / ' + s.format : '') + '）';
      sel.appendChild(o);
    });
    if (selected && sel.querySelector('option[value="' + selected + '"]')) sel.value = selected;
  }

  function fillCongestion() {
    var sel = $('s-congestion');
    sel.innerHTML = '';
    Object.keys(CE.CONGESTION).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = CE.CONGESTION[k].label;
      sel.appendChild(o);
    });
  }

  function updateTheaterNote() {
    var t = D.theater(S.plan.theaterId);
    $('theater-note').textContent = t && t.note ? t.note : '';
    /* チェーンはプランに持つが、選択は劇場だけで済ませる */
    if (t) S.plan.chain = t.chain;
    var ch = t ? D.chains[t.chain] : null;
    $('chain-note').textContent = ch ? ch.note : '';
  }

  function renderTickets() {
    var wrap = $('ticket-rows');
    if (!wrap) return;   /* 券種内訳UIは廃止（価格ミス防止のため自動選択しない） */
    wrap.innerHTML = '';
    D.ticketTypes.forEach(function (tt) {
      var row = document.createElement('div');
      row.className = 'ticket-row';
      row.innerHTML = '<span class="tname">' + tt.name + '</span>' +
        '<span class="tprice">¥' + tt.price.toLocaleString() + '</span>';
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.max = '8';
      inp.value = S.plan.tickets[tt.id] || 0;
      inp.addEventListener('input', function () {
        var v = Math.max(0, parseInt(inp.value, 10) || 0);
        if (v === 0) delete S.plan.tickets[tt.id]; else S.plan.tickets[tt.id] = v;
        updateTicketSum();
      });
      row.appendChild(inp);
      wrap.appendChild(row);
    });
    updateTicketSum();
  }

  function updateTicketSum() {
    if (!$('ticket-sum')) return;   /* 券種内訳UIは廃止 */
    var sc = currentScreen();
    var extra = sc && sc.surcharge ? sc.surcharge : 0;
    var n = 0, yen = 0;
    D.ticketTypes.forEach(function (tt) {
      var q = S.plan.tickets[tt.id] || 0;
      n += q; yen += q * (tt.price + extra);
    });
    var el = $('ticket-sum');
    var msg = '合計 ' + n + '枚 / ¥' + yen.toLocaleString();
    if (extra) msg += '（' + sc.format + ' 追加料金 +¥' + extra.toLocaleString() + '/枚 を含む）';
    if (n !== S.plan.count) {
      msg += ' — 枚数（' + S.plan.count + '枚）と一致していません';
      el.style.color = 'var(--warn)';
    } else {
      el.style.color = '';
    }
    el.textContent = msg;
  }

  /** 編集中プラン -> フォーム */
  function writeForm() {
    var p = S.plan;
    fillTheaters(p.theaterId);
    p.theaterId = $('f-theater').value;
    updateTheaterNote();
    fillScreens(p.theaterId, p.screenId);
    p.screenId = $('f-screen').value;
    $('f-title').value = p.title;
    $('f-date').value = p.date;
    $('f-time').value = p.showtime;
    $('f-runtime').value = p.runtime;
    $('f-onsale').value = p.onSaleAt;
    var mx = currentRules().maxSeats || 8;
    $('count-hint').textContent = '選んだ席をまとめて確保します（人数分だけ席を選択）。一度に選べるのは最大' + mx + '席です。';
    $('f-count').value = p.count || 0;
    if (typeof syncCountUI === 'function') syncCountUI();
    renderTickets();

    $('s-poll').value = p.strategy.pollIntervalMs;
    $('s-preconnect').value = p.strategy.preconnectSec;
    $('s-deadline').value = p.strategy.deadlineSec;
    $('s-fallback').checked = !!p.strategy.fallbackAny;
    $('s-holdfirst').checked = p.strategy.holdFirst !== false;
    $('s-congestion').value = p.mock.congestion;
    $('s-seed').value = p.mock.seed;
    $('s-speed').value = p.mock.speed;

    renderPlanList();
    updateSeatContext();
  }

  /** フォーム -> 編集中プラン */
  function readForm() {
    var p = S.plan;
    p.theaterId = $('f-theater').value;
    var t = D.theater(p.theaterId);
    if (t) p.chain = t.chain;
    var maxSeats = currentRules().maxSeats || 8;
    p.screenId = $('f-screen').value;
    p.title = $('f-title').value.trim();
    p.date = $('f-date').value;
    p.showtime = $('f-time').value;
    p.runtime = parseInt($('f-runtime').value, 10) || 120;
    p.onSaleAt = $('f-onsale').value;
    p.count = Math.max(1, Math.min(maxSeats, parseInt($('f-count').value, 10) || 1));
    if (parseInt($('f-count').value, 10) > maxSeats) {
      $('f-count').value = maxSeats;
      toast('この劇場で一度に予約できるのは最大' + maxSeats + '席です');
    }
    p.strategy.pollIntervalMs = parseInt($('s-poll').value, 10) || 1000;
    p.strategy.preconnectSec = parseInt($('s-preconnect').value, 10) || 0;
    p.strategy.deadlineSec = parseInt($('s-deadline').value, 10) || 180;
    p.strategy.fallbackAny = $('s-fallback').checked;
    p.strategy.holdFirst = $('s-holdfirst').checked;
    p.mock.congestion = $('s-congestion').value;
    p.mock.seed = $('s-seed').value;
    p.mock.speed = Math.max(1, parseInt($('s-speed').value, 10) || 1);
  }

  /* ---- プラン一覧 -------------------------------------------------- */

  function renderPlanList() {
    var wrap = $('plan-list');
    wrap.innerHTML = '';
    if (!S.plans.length) {
      wrap.innerHTML = '<div class="empty">保存したプランはまだありません。上の内容を入力して「このプランを保存」を押してください。</div>';
      return;
    }
    S.plans.forEach(function (p) {
      var t = D.theater(p.theaterId);
      var item = document.createElement('div');
      item.className = 'plan-item' + (p.id === S.plan.id ? ' on' : '');
      var main = document.createElement('div');
      main.className = 'pi-main';
      main.innerHTML = '<div class="pi-title">' + esc(p.title || '（無題）') + '</div>' +
        '<div class="pi-meta">' + esc(t ? t.name : '?') + ' / ' + esc(p.date + ' ' + p.showtime) +
        ' / ' + p.count + '枚 / ' + (p.candidates[0] ? p.candidates[0].seats.join(' ') : '座席未選択') + '</div>';
      main.addEventListener('click', function () {
        S.plan = JSON.parse(JSON.stringify(p));
        S.pick = [];
        writeForm();
        toast('プランを読み込みました');
      });
      var del = document.createElement('button');
      del.className = 'pi-del';
      del.textContent = '削除';
      del.title = 'このプランを削除';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        S.plans = S.plans.filter(function (x) { return x.id !== p.id; });
        savePlans();
        renderPlanList();
      });
      item.appendChild(main);
      item.appendChild(del);
      wrap.appendChild(item);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- 座席マップ -------------------------------------------------- */

  function currentScreen() {
    return D.screen(S.plan.theaterId, S.plan.screenId);
  }

  /** 現在のチェーンの予約ルール。未定義でも安全な既定値を返す */
  function currentRules() {
    var ch = D.chains[S.plan.chain];
    return (ch && ch.rules) || { maxSeats: 8, singleGap: { enforce: false, warn: false }, notes: [] };
  }

  /** 現在のスクリーンの車椅子スペース（座席ID -> true） */
  function wheelchairSet() {
    var sc = currentScreen();
    var out = {};
    if (!sc) return out;
    CE.expandSeats(sc).forEach(function (s) {
      if (!CE.isSelectable(s)) out[s.id] = true;
    });
    return out;
  }

  /** 座席 id -> 候補の順位（1始まり）。候補に無ければ 0 */
  function candRankOf(seatId) {
    for (var i = 0; i < S.plan.candidates.length; i++) {
      if (S.plan.candidates[i].seats.indexOf(seatId) >= 0) return i + 1;
    }
    return 0;
  }

  /**
   * 座席マップを描く。
   * live=true なら実行中の座席状況（S.liveMap）を反映し、クリックを受け付けない。
   */
  function renderSeatmap(container, live) {
    var screen = currentScreen();
    container.innerHTML = '';
    if (!screen) return;

    /* 席番号 = スクリーンに向かって左からのグリッド位置（KINEZO 実採番）。
       gridColumn に番号をそのまま使えば欠番（縦通路）が自然に空く。
       半席刻みグリッドで、席1つは2カラムぶんを占める。 */
    var cols = (screen.gridWidth || 0) * 2;
    var seats = CE.expandSeats(screen);
    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    screen.rows.forEach(function (r) {
      var rowEl = document.createElement('div');
      rowEl.className = 'seat-row';
      if (r.gapBefore) rowEl.classList.add('cross-aisle');

      var lab = document.createElement('span');
      lab.className = 'row-label';
      lab.textContent = r.label;
      rowEl.appendChild(lab);

      var grid = document.createElement('div');
      grid.className = 'seat-grid';
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', var(--seat-half))';

      (byRow[r.label] || []).forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'seat';
        b.dataset.seat = s.id;
        b.style.gridColumn = ((s.num - 1) * 2 + 1) + ' / span 2';
        b.title = s.id;

        var st = 'free';
        if (live && S.liveMap) {
          var m = S.liveMap[s.id];
          if (m === 'mine') st = 'mine';
          else if (m === 'taken') st = 'taken';
          else if (m === 'blocked') st = 'blocked';
        }
        var rank = candRankOf(s.id);
        if (st === 'free') {
          if (S.pick.indexOf(s.id) >= 0) st = 'picked';
          else if (rank) st = 'cand';
        }
        if (st === 'cand') b.textContent = rank;
        if (st === 'mine') b.textContent = '✓';
        b.dataset.st = st;

        if (live) {
          b.disabled = true;
        } else {
          b.addEventListener('click', function () { onSeatClick(s, screen); });
        }
        grid.appendChild(b);
      });

      rowEl.appendChild(grid);
      rowEl.appendChild(lab.cloneNode(true));
      container.appendChild(rowEl);
    });
  }


  /* ---- 実座席図（手元 runner から取得。全劇場で実レイアウト＋空席を表示）---- */

  function seatShowKey() {
    return [S.plan.theaterId, S.plan.date, S.plan.title, S.plan.showtime].join('|');
  }
  function useRunnerSeatMap() {
    return !!(S.runnerSeatMap && S.runnerSeatMap.key === seatShowKey() && S.runnerSeatMap.seats.length);
  }

  /* 選択席の間に1席だけ空きが残る箇所（実座席の byId で判定）。 */
  function gapFromById(seatIds, byId) {
    var picked = {}; seatIds.forEach(function (id) { picked[id] = 1; });
    var gaps = [];
    seatIds.forEach(function (id) {
      var s0 = byId[id]; if (!s0) return;
      var midId = s0.row + '-' + (s0.num + 1), farId = s0.row + '-' + (s0.num + 2);
      var mid = byId[midId], far = byId[farId];
      if (mid && far && picked[farId] && !picked[midId] && mid.state === 'available' && gaps.indexOf(midId) < 0) gaps.push(midId);
    });
    return gaps;
  }
  function activeGap(seatIds) {
    if (useRunnerSeatMap()) return gapFromById(seatIds, S.runnerSeatMap.byId);
    var screen = currentScreen();
    return screen ? singleGapSeats(seatIds, screen) : [];
  }

  function setSeatRunnerNote(state, html) {
    var el = $('seat-runner-note'); if (!el) return;
    if (!state) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false; el.className = 'seat-runner-note ' + state; el.innerHTML = html;
  }

  async function loadRunnerSeatMap() {
    var t = D.theater(S.plan.theaterId);
    if (!t || !S.plan.title || !S.plan.showtime || !S.plan.date) { setSeatRunnerNote('', ''); return; }
    var key = seatShowKey();
    /* 席がある実データを持っているときだけキャッシュ採用。空(=以前失敗)なら取り直す。 */
    if (S.runnerSeatMap && S.runnerSeatMap.key === key && S.runnerSeatMap.seats.length) {
      setSeatRunnerNote('ok', '実際の座席図（' + esc(S.runnerSeatMap.screenName ? S.runnerSeatMap.screenName + '・' : '') + '空席反映）を表示しています');
      return;
    }
    setSeatRunnerNote('checking', '<span class="spin"></span> 実際の座席図を手元の runner から取得中…');
    try {
      var url = runnerBase() + '/seatmap?theater=' + encodeURIComponent(t.runnerKey || 'yokohama') +
        '&date=' + encodeURIComponent(S.plan.date) + '&title=' + encodeURIComponent(S.plan.title) +
        '&time=' + encodeURIComponent(S.plan.showtime);
      var data = await fetchJsonRetry(url, 20000, 3);
      var byId = {}; (data.seats || []).forEach(function (s0) { byId[s0.id] = s0; });
      S.runnerSeatMap = { key: key, seats: data.seats || [], byId: byId, screenName: data.screenName || '', cols: data.cols || 0 };
      /* 選択済みだった席のうち、実座席に存在しないものは外す（偽レイアウトからの引き継ぎ対策） */
      var sel = selectedSeats().filter(function (id) { return byId[id]; });
      S.plan.candidates = sel.length ? [{ id: 'target', seats: sel.sort(seatSort) }] : [];
      setSeatRunnerNote('ok', '実際の座席図（' + esc(data.screenName ? data.screenName + '・' : '') + '空席反映）を表示しています');
      renderSeatEditor();
    } catch (e) {
      S.runnerSeatMap = null;
      setSeatRunnerNote('down', '実際の座席図は取得できませんでした（runner未起動 or 対象回なし）。暫定レイアウトで席番号だけ選べます。<code>node runner/serve.js</code> を起動して座席画面を開き直してください。');
      renderSeatEditor();
    }
  }

  /* 実座席図を描画。行＝row（英字）、列＝num。空席のみクリック可。 */
  function renderRunnerSeatmap(container) {
    container.innerHTML = '';
    var m = S.runnerSeatMap; if (!m) return;
    var byRow = {};
    m.seats.forEach(function (s0) { (byRow[s0.row] = byRow[s0.row] || []).push(s0); });
    var rowKeys = Object.keys(byRow).sort();
    var maxNum = m.cols || m.seats.reduce(function (mx, s0) { return Math.max(mx, s0.num); }, 0);
    var cols = maxNum * 2;
    var selSet = {}; selectedSeats().forEach(function (id) { selSet[id] = 1; });

    rowKeys.forEach(function (rl) {
      var rowEl = document.createElement('div');
      rowEl.className = 'seat-row';
      var lab = document.createElement('span');
      lab.className = 'row-label'; lab.textContent = rl;
      rowEl.appendChild(lab);
      var grid = document.createElement('div');
      grid.className = 'seat-grid';
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', var(--seat-half))';
      byRow[rl].slice().sort(function (a, b) { return a.num - b.num; }).forEach(function (s0) {
        var b = document.createElement('button');
        b.className = 'seat';
        b.dataset.seat = s0.id;
        b.style.gridColumn = ((s0.num - 1) * 2 + 1) + ' / span 2';
        b.title = s0.id;
        var st = 'free';
        if (s0.state !== 'available') st = 'taken';
        if (st === 'free' && selSet[s0.id]) st = 'cand';
        if (st === 'cand') b.textContent = (selectedSeats().indexOf(s0.id) + 1);
        b.dataset.st = st;
        if (st === 'taken') b.disabled = true;
        else b.addEventListener('click', function () { onSeatClick(s0, null); });
        grid.appendChild(b);
      });
      rowEl.appendChild(grid);
      rowEl.appendChild(lab.cloneNode(true));
      container.appendChild(rowEl);
    });
  }

  function renderSeatEditor() {
    updateSeatContext();
    if (useRunnerSeatMap()) renderRunnerSeatmap($('seatmap'));
    else renderSeatmap($('seatmap'), false);
    renderTray();
    renderSeatRanking();
  }

  /** 利き目の設定（'right' | 'left' | ''）。個人情報ではないので常時この端末に保存する。 */
  function getEye() { try { return localStorage.getItem(LS_EYE) || ''; } catch (e) { return ''; } }
  function setEye(v) { try { if (v) localStorage.setItem(LS_EYE, v); else localStorage.removeItem(LS_EYE); } catch (e) {} }

  /**
   * この劇場（スクリーン）のおすすめ席ランキング TOP10。
   * 3軸で表示：中央からのズレ／音響(100点)／迫力(100点)。並び順は3軸＋利き目補正の合成スコア。
   * 座席配置から決まる静的な指標（空席状況は反映しない）。行クリックでその席を選択/解除。
   */
  function renderSeatRanking() {
    var box = $('seat-ranking');
    if (!box) return;
    var screen = currentScreen();
    if (!screen || !window.CinemaEngine || !CE.seatAxes) { box.innerHTML = ''; box.hidden = true; return; }
    var seats = CE.expandSeats(screen).filter(function (s) { return CE.isSelectable(s); });
    if (!seats.length) { box.innerHTML = ''; box.hidden = true; return; }
    var eye = getEye();
    var ranked = seats.map(function (s) { return { seat: s, ax: CE.seatAxes(s, screen, { eye: eye }) }; })
      .sort(function (a, b) { return b.ax.rank - a.ax.rank; }).slice(0, 10);
    var sel = selectedSeats();
    var eyeNote = eye === 'right' ? '利き目=右：右目がスクリーン中心線に来るよう、同点なら左側の席を優先（ごく僅かな補正）'
      : (eye === 'left' ? '利き目=左：左目がスクリーン中心線に来るよう、同点なら右側の席を優先（ごく僅かな補正）' : '利き目 未設定：スクリーン中心を優先');
    /* 列ブロック自体がスクリーン中心から寄っている列を注記（「列の真ん中」≠「スクリーン中心」の混乱を防ぐ） */
    var gridCenter = (seats.reduce(function (m, s) { return Math.max(m, s.col); }, 0) + 1) / 2;
    var rowMin = {}, rowMax = {};
    seats.forEach(function (s) { var r = String(s.id).split('-')[0]; rowMin[r] = Math.min(rowMin[r] == null ? Infinity : rowMin[r], s.col); rowMax[r] = Math.max(rowMax[r] == null ? -Infinity : rowMax[r], s.col); });
    var shifted = {};
    Object.keys(rowMin).forEach(function (r) { var d = (rowMin[r] + rowMax[r]) / 2 - gridCenter; if (Math.abs(d) >= 0.75) { var key = (d < 0 ? '左' : '右') + Math.round(Math.abs(d) * 2) / 2; (shifted[key] = shifted[key] || []).push(r); } });
    var rowNote = Object.keys(shifted).map(function (key) { var rs = shifted[key].sort(); return (rs.length > 2 ? rs[0] + '〜' + rs[rs.length - 1] : rs.join('・')) + '列は列全体が中心より約' + key.slice(1) + '席' + key.slice(0, 1) + '寄り'; }).join('／');
    var html = '<div class="rank-head"><div class="rank-title">この劇場のおすすめ席 TOP10（' + (screen.name || 'スクリーン') + '）</div>' +
      '<label class="rank-eye">利き目 <select id="eye-select">' +
        '<option value=""' + (eye === '' ? ' selected' : '') + '>未設定</option>' +
        '<option value="right"' + (eye === 'right' ? ' selected' : '') + '>右目</option>' +
        '<option value="left"' + (eye === 'left' ? ' selected' : '') + '>左目</option>' +
      '</select></label></div>' +
      '<div class="rank-cols"><span></span><span>席</span><span>スクリーン中心からのズレ</span><span>音響</span><span>迫力</span><span></span></div><ol class="rank-list">';
    ranked.forEach(function (r) {
      var picked = sel.indexOf(r.seat.id) >= 0, ax = r.ax;
      var offLabel = ax.offsetN === 0 ? '中央' : ax.offsetDir + (Number.isInteger(ax.offsetN) ? ax.offsetN : ax.offsetN.toFixed(1)) + '席';
      html += '<li class="rank-item' + (picked ? ' picked' : '') + '" data-seat="' + r.seat.id + '">' +
        '<span class="rank-seat">' + r.seat.id + '</span>' +
        '<span class="rank-off">' + offLabel + '</span>' +
        '<span class="rank-pt">' + ax.sound + '<small>点</small></span>' +
        '<span class="rank-pt">' + ax.impact + '<small>点</small></span>' +
        '<span class="rank-pick">' + (picked ? '選択中' : '選ぶ') + '</span></li>';
    });
    html += '</ol><p class="rank-hint">ズレは「列の真ん中」ではなく<b>スクリーンの中心線</b>からの距離です' + (rowNote ? '（' + rowNote + '。列の真ん中とスクリーン中心は一致しません）' : '') + '。' +
      eyeNote + '。音響＝中央寄り・前後2/3付近がスイートスポット／迫力＝画面が視野を満たす度合い（前寄り・中央）。' +
      '座席配置に基づく静的な指標で、空席状況は反映していません。行クリックで選択/解除。</p>';
    box.innerHTML = html;
    box.hidden = false;
    var es = box.querySelector('#eye-select');
    if (es) es.addEventListener('change', function () { setEye(es.value); renderSeatRanking(); });
    Array.prototype.forEach.call(box.querySelectorAll('.rank-item'), function (li) {
      li.addEventListener('click', function () {
        var id = li.getAttribute('data-seat');
        var s = CE.expandSeats(screen).find(function (x) { return x.id === id; });
        if (s) onSeatClick(s, screen);
      });
    });
  }

  function renderLiveMap() {
    renderSeatmap($('seatmap-live'), true);
  }

  function renderRulesBox() {
    var box = $('rules-box');
    if (!box) return;
    var ch = D.chains[S.plan.chain];
    var r = currentRules();
    var items = (r.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    if (r.singleGap && (r.singleGap.warn || r.singleGap.enforce) && r.singleGap.note) {
      items += '<li>' + esc(r.singleGap.note) + '</li>';
    }
    box.innerHTML =
      '<div class="rules-head">' + esc(ch ? ch.name : '') + ' の予約ルール' +
      (r.asOf ? '<span class="rules-asof">' + esc(r.asOf.replace(/-/g, '/')) + ' 時点</span>' : '') +
      '</div><ul>' + items + '</ul>';
  }

  function updateSeatContext() {
    var t = D.theater(S.plan.theaterId);
    var sc = currentScreen();
    var scLabel = S.plan.screenLabel || (sc ? sc.name + (sc.format ? '（' + sc.format + '）' : '') : '?');
    $('seat-context').textContent =
      (t ? t.name : '?') + ' ' + scLabel + ' ／ ' +
      (S.plan.title || '（作品未入力）') + ' ／ ' + S.plan.date + ' ' + S.plan.showtime +
      ' ／ ' + S.plan.count + '枚';
  }

  /* 選択中の座席（＝そのまま確保対象）を返す。1グループのみ扱う。 */
  function selectedSeats() {
    return (S.plan.candidates[0] && S.plan.candidates[0].seats) ? S.plan.candidates[0].seats.slice() : [];
  }

  /* 選択座席から枚数UI（表示＋隠しフィールド）を同期する。枚数は席数から決まる。 */
  function syncCountUI() {
    var n = selectedSeats().length;
    S.plan.count = n;
    var ro = $('count-readout'); if (ro) ro.textContent = n + '席';
    var fc = $('f-count'); if (fc) fc.value = n;
  }

  function onSeatClick(seat, screen) {
    /* 「席を選んでから枚数が決まる」方式。1クリック=1席の追加/解除。
       選んだ席がそのまま確保対象（candidates）になり、枚数＝選択席数。 */
    var sel = selectedSeats();
    var i = sel.indexOf(seat.id);
    if (i >= 0) {
      sel.splice(i, 1);                         // すでに選択中 → 解除
    } else {
      var mx = currentRules().maxSeats || 8;    // 上限だけは劇場ルールで縛る
      if (sel.length >= mx) { toast('一度に確保できるのは最大' + mx + '席です'); return; }
      sel.push(seat.id);
    }
    sel.sort(seatSort);
    S.plan.candidates = sel.length ? [{ id: 'target', seats: sel }] : [];
    S.pick = [];
    syncCountUI();
    /* 席の間に1席だけ空きが残る配置は、この方式では「注意」表示に留める（ブロックしない）。 */
    renderSeatEditor();
  }


  /**
   * 選択席の間に「1席だけ空いた予約可能席」が残る箇所を返す。
   * 同じ列で番号差が2、間の席が実在して選択可能な場合のみ該当。
   * 縦通路（欠番）を挟む場合は間の席が存在しないので該当しない。
   */
  function singleGapSeats(seatIds, screen) {
    var byId = {};
    CE.expandSeats(screen).forEach(function (s) { byId[s.id] = s; });
    var picked = {};
    seatIds.forEach(function (id) { picked[id] = true; });
    var out = [];
    seatIds.forEach(function (id) {
      var a = byId[id];
      if (!a) return;
      var midId = a.row + '-' + (a.num + 1);
      var otherId = a.row + '-' + (a.num + 2);
      var mid = byId[midId];
      /* mid が実在して空席なら、a と other の間に1席だけ空きが残る配置。
         縦通路をまたぐ場合は mid（欠番番号）が存在しないので該当しない。 */
      if (picked[otherId] && !picked[midId] && mid && CE.isSelectable(mid) &&
          out.indexOf(midId) < 0) {
        out.push(midId);
      }
    });
    return out;
  }

  function renderTray() {
    var el = $('tray-seats');
    var seats = selectedSeats();
    var nextBtn = $('btn-to-run');
    if (nextBtn) nextBtn.disabled = !seats.length;
    syncCountUI();
    if (seats.length) {
      var gaps = activeGap(seats);
      el.textContent = seats.join('  /  ') + '（' + seats.length + '席）' +
        (gaps.length ? '　⚠ 間に1席空き（' + gaps.join(' / ') + '）が残ります' : '');
      el.classList.remove('empty-t');
      el.classList.add('confirmed');
    } else {
      el.textContent = '座席表からクリックして選んでください（選んだ席数がそのまま枚数になります）';
      el.classList.add('empty-t');
      el.classList.remove('confirmed');
    }
  }

  /* ---- 候補 -------------------------------------------------------- */

  function seatSort(a, b) {
    var ra = a.split('-')[0], rb = b.split('-')[0];
    if (ra !== rb) return ra < rb ? -1 : 1;
    return parseInt(a.split('-')[1], 10) - parseInt(b.split('-')[1], 10);
  }

  /**
   * 中央の見やすい席を選ぶ。既定は1席（すでに複数選択中ならその枚数分の連席）。
   */
  function autoPick() {
    var screen = currentScreen();
    if (!screen) return;
    /* auto は現在の選択数を中央に。未選択なら1席だけ選ぶ（以前は2席固定だった）。 */
    var need = selectedSeats().length >= 1 ? selectedSeats().length : 1;
    var seats = CE.expandSeats(screen);
    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    var best = null, bestScore = -1;
    Object.keys(byRow).forEach(function (rowLabel) {
      var list = byRow[rowLabel].slice().sort(function (a, b) { return a.num - b.num; });
      for (var i = 0; i + need <= list.length; i++) {
        var g = list.slice(i, i + need), ok = true, score = 0;
        for (var j = 0; j < g.length; j++) {
          /* 番号が連続していなければ（縦通路の欠番をまたげば）連席ではない */
          if (j > 0 && g[j].num !== g[j - 1].num + 1) { ok = false; break; }
          if (!CE.isSelectable(g[j])) { ok = false; break; }
          score += CE.popularity(g[j], screen);
        }
        if (!ok) continue;
        score /= need;
        if (score > bestScore) { bestScore = score; best = g.map(function (s) { return s.id; }); }
      }
    });

    if (!best) { toast('枚数分の連席が見つかりませんでした'); return; }
    S.plan.candidates = [{ id: 'target', seats: best }];
    S.pick = [];
    renderSeatEditor();
    toast(best.join(' / ') + ' を選びました');
  }

  /* ---- 実行 -------------------------------------------------------- */

  function setState(st, detail) {
    var chip = $('state-chip');
    var labels = {
      idle: '待機中', waiting: '発売待ち', connecting: '接続中',
      hunting: '確保を試行中', held: '確保成功', failed: '確保できず', aborted: '中止'
    };
    chip.dataset.state = st;
    chip.textContent = labels[st] || st;

    if (st === 'hunting' && detail && detail.seatMap) {
      S.liveMap = detail.seatMap;
      renderLiveMap();
      var free = 0;
      for (var k in detail.seatMap) if (detail.seatMap[k] === 'available') free++;
      $('state-detail').textContent = '試行 ' + detail.attempt + '回 / 空席 ' + free + '席';
    } else if (st === 'held') {
      S.result = detail;
      renderTimeline(detail.timeline);
      if (S.adapter) {
        var snap = S.adapter.fetchSeatMap({
          now: (S.clock ? S.clock.now() : Date.now()),
          onSaleAt: onSaleMs(S.plan)
        });
        S.liveMap = snap.seats;
        renderLiveMap();
      }
      $('state-detail').textContent = detail.seats.join(' / ') + ' を確保';
      renderResult();
      showView('result');
    } else if (st === 'failed') {
      S.result = null;
      renderTimeline(S.runner ? S.runner.timeline : null);
      var reasons = { timeout: '打ち切り時間に到達', exhausted: '候補がすべて埋まりました', request_limit: 'リクエスト上限に到達' };
      $('state-detail').textContent = (detail && reasons[detail.reason]) || '';
      renderResult();
    } else if (st !== 'hunting') {
      $('state-detail').textContent = '';
    }

    var running = (st === 'waiting' || st === 'connecting' || st === 'hunting');
    $('btn-run-live').disabled = running;
    $('btn-run-rehearsal').disabled = running;
    $('btn-run-abort').disabled = !running;
  }

  /** どこに何msかかったかの内訳。実行が終わるたびに描き直す。 */
  function renderTimeline(marks) {
    var card = $('timeline-card');
    var body = $('timeline-body');
    if (!marks || !marks.length) { card.hidden = true; body.innerHTML = ''; return; }
    card.hidden = false;
    /* リハーサルは仮想時間なので、タイマーのズレが早送り倍率ぶん拡大して見える。
       本番の数字と取り違えないよう明示する。 */
    $('timeline-note').textContent = S.rehearsal
      ? 'リハーサル（' + S.plan.mock.speed + '倍速）の仮想時間です。発火のズレは倍率ぶん拡大されて見えます。'
      : '';
    body.innerHTML = '';
    marks.forEach(function (m, i) {
      var tr = document.createElement('tr');
      var rel = Math.round(m.rel);
      tr.innerHTML =
        '<td>' + esc(m.label) + '</td>' +
        '<td class="num">' + (rel >= 0 ? '+' : '') + rel.toLocaleString() + ' ms</td>' +
        '<td class="num">' + (i === 0 ? '—' : Math.round(m.delta).toLocaleString() + ' ms') + '</td>';
      body.appendChild(tr);
    });
  }

  function pushLog(e) {
    S.logs.push(e);
    appendLogLine(e);
  }

  function appendLogLine(e) {
    if (e.level === 'dim' && !$('log-verbose').checked) return;
    var box = $('log');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    var line = document.createElement('div');
    line.className = 'log-line ' + e.level;
    var rel = (e.rel >= 0 ? '+' : '') + e.rel.toFixed(1) + 's';
    line.innerHTML = '<span class="log-t">' + esc(rel) + '</span><span class="log-m">' + esc(e.msg) + '</span>';
    box.appendChild(line);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function redrawLog() {
    $('log').innerHTML = '';
    S.logs.forEach(appendLogLine);
  }

  function validateForRun() {
    readForm();
    if (!S.plan.title) return '作品タイトルを入力してください';
    if (!S.plan.date || !S.plan.showtime) return '上映日と開映時刻を入力してください';
    if (!S.plan.onSaleAt || isNaN(onSaleMs(S.plan))) return '発売開始日時を入力してください';
    if (!S.plan.candidates.length) return '座席表から座席を選んでください';
    if (S.plan.candidates[0].seats.length !== S.plan.count) {
      return '枚数（' + S.plan.count + '枚）と選んだ席数が一致していません';
    }
    return null;
  }

  /* ---- 本物の予約（手元 runner の /reserve を叩く）---- */
  function setReserveChip(stateKey) {
    var chip = $('state-chip');
    var labels = { connecting: '接続中', hunting: '確保を試行中', held: '確保成功', failed: '確保できず' };
    chip.dataset.state = stateKey; chip.textContent = labels[stateKey] || stateKey;
    var running = stateKey === 'connecting' || stateKey === 'hunting';
    if ($('btn-run-live')) $('btn-run-live').disabled = running;
    if ($('btn-run-rehearsal')) $('btn-run-rehearsal').disabled = running;
  }

  async function reserveViaRunner() {
    var t = D.theater(S.plan.theaterId);
    var seats = (S.plan.candidates || []).map(function (g) { return g.seats.join(','); }).join(' / ');
    if (!t || !S.plan.title || !S.plan.showtime || !S.plan.date || !seats) { toast('先に上映回と座席を選んでください'); return; }
    /* 発売がまだ先なら --at で待機。発売中（過去/直近）は付けずに即実行。 */
    var at = '';
    var ms = onSaleMs(S.plan);
    if (S.plan.onSaleAt && !isNaN(ms) && ms > Date.now() + 2000) {
      var v = S.plan.onSaleAt.length === 16 ? S.plan.onSaleAt + ':00' : S.plan.onSaleAt;
      at = v + '+09:00';
    }
    S.rehearsal = false; renderTimeline(null);
    $('log').innerHTML = ''; S.logs = [];
    S.runStart = Date.now();
    setReserveChip('connecting');
    pushLog({ rel: 0, level: 'info', msg: '手元の runner に予約実行を依頼しました（席: ' + seats + '）' + (at ? ' ／ 発売 ' + S.plan.onSaleAt + ' まで待機します' : '（発売中：即時実行）') });
    var body = { theater: t.runnerKey || 'yokohama', date: S.plan.date, title: S.plan.title, time: S.plan.showtime, seats: seats, at: at };
    try {
      var r = await fetch(runnerBase() + '/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || '起動に失敗しました');
      pollReserve(j.id);
    } catch (e) {
      setReserveChip('failed');
      pushLog({ rel: 0, level: 'warn', msg: 'runner に接続できませんでした。サイトを http://127.0.0.1:8790/ で開き、番組表サーバが起動しているか確認してください（' + e.message + '）' });
    }
  }

  function pollReserve(id) {
    var seen = 0;
    var iv = setInterval(function () {
      fetchJson(runnerBase() + '/reserve/status?id=' + encodeURIComponent(id), 8000).then(function (j) {
        for (var i = seen; i < j.log.length; i++) {
          var msg = j.log[i];
          var level = /失敗|エラー|できません|不可|売切|取れませ|確保できません/.test(msg) ? 'warn' : 'info';
          pushLog({ rel: (Date.now() - (S.runStart || Date.now())) / 1000, level: level, msg: msg });
        }
        seen = j.log.length;
        if (!seen && !j.done) setReserveChip('hunting');
        if (j.done) {
          clearInterval(iv);
          var openOnly = j.log.some(function (l) { return /自動確保に非対応|予約ページを開きました/.test(l); });
          var ok = j.code === 0 && !j.log.some(function (l) { return /確保できません|取れませ|売切/.test(l); });
          setReserveChip(ok ? 'held' : 'failed');
          pushLog({ rel: (Date.now() - (S.runStart || Date.now())) / 1000, level: 'info',
            msg: !ok ? '予約プロセスが終了しました。ログを確認してください。'
              : openOnly ? '開いたブラウザの予約ページで、座席を選んで券種選択→購入を進めてください（新文芸坐は予約サイトの仕様上、自動確保に非対応です）。'
              : '✓ 席を確保しました。開いた決済ブラウザ（Brave/Chrome）で券種選択・支払いを進めてください（券種は自動選択しません）。' });
        }
      }).catch(function () { /* 一時的な失敗は無視して次のポーリングへ */ });
    }, 700);
  }

  function startRun(rehearsal) {
    var err = validateForRun();
    if (err) { toast(err); return; }

    var screen = currentScreen();
    S.logs = [];
    S.result = null;
    $('log').innerHTML = '';
    renderTimeline(null);

    var onSale = onSaleMs(S.plan);
    var speed = 1;
    var base = Date.now();

    if (rehearsal) {
      speed = S.plan.mock.speed;
      /* リハーサルでは「発売の少し前」から始める。実際の発売日時を待たずに
         同じ流れ（待機 → 事前接続 → 確保ループ）を検証できるようにする。 */
      var lead = (S.plan.strategy.preconnectSec + 5) * 1000;
      base = onSale - lead;
    } else if (onSale < Date.now()) {
      /* 既に発売中 → 待たずに即座に確保へ進む（発売中のチケットは即時購入できる）。 */
      base = Date.now();
      toast('発売中の上映回です。待機せず即座に確保を試みます');
    }

    /* 本番実行では、測ったオフセットを時計に載せる。
       リハーサルは時刻を作り替えるので補正しない。 */
    var offset = (!rehearsal && S.sync && S.sync.uncertainty != null) ? S.sync.offset : 0;
    if (!rehearsal) {
      if (offset) {
        pushLog({ rel: (Date.now() + offset - onSale) / 1000, level: 'info',
          msg: 'サーバ時刻とのズレ ' + (offset >= 0 ? '+' : '') + offset + 'ms を補正して実行します' });
      } else {
        pushLog({ rel: (Date.now() - onSale) / 1000, level: 'warn',
          msg: 'サーバ時刻と同期していません。手元の時計のズレがそのまま出遅れになります' });
      }
      if (document.hidden) {
        pushLog({ rel: (Date.now() - onSale) / 1000, level: 'warn',
          msg: 'タブが背景にあります。表示したままにしてください' });
      }
    }

    var clock = new CR.Clock({ speed: speed, base: base, offset: offset });
    S.clock = clock;
    S.rehearsal = !!rehearsal;
    S.adapter = new CE.MockAdapter({
      screen: screen,
      congestion: S.plan.mock.congestion,
      seed: S.plan.mock.seed + '|' + S.plan.screenId + '|' + S.plan.count
    });
    S.liveMap = null;

    var runPlan = JSON.parse(JSON.stringify(S.plan));
    runPlan.onSaleAt = onSale;
    runPlan.theaterName = (D.theater(S.plan.theaterId) || {}).name;
    runPlan.screenName = screen.name;

    S.runner = new CR.Runner({
      plan: runPlan, adapter: S.adapter, clock: clock,
      onLog: pushLog, onState: setState
    });

    if (S.visWatch) S.visWatch.stop();
    S.visWatch = new CS.VisibilityWatch(function () {
      pushLog({ rel: (syncedNow() - onSale) / 1000, level: 'warn',
        msg: 'タブが背景に回りました。タイマーがまとめられ、発火が遅れる可能性があります' });
    });

    if (rehearsal) {
      pushLog({
        rel: (base - onSale) / 1000,
        level: 'warn',
        msg: '── リハーサル（' + speed + '倍速・モック環境）──'
      });
    }
    S.runner.run();
  }

  /* ---- サーバ時刻との同期 ------------------------------------------

     手元の時計がずれていると、そのぶんまるごと出遅れる。
     同一オリジン（このページ自身）に HEAD を投げて Date ヘッダから
     オフセットを推定する。Phase 2 のローカル runner では
     KINEZO のレスポンスから同じ方法で測る。 */

  function renderSyncResult(msg, cls) {
    var el = $('sync-result');
    el.textContent = msg;
    el.className = 'sync-result' + (cls ? ' ' + cls : '');
  }

  var _lastSyncAt = 0;
  var _syncing = false;

  /* 手動操作なしで自動同期する。未同期、または前回から3分以上経っていれば測り直す。 */
  function autoSync() {
    if (_syncing) return;
    var synced = S.sync && S.sync.uncertainty != null;
    if (synced && (Date.now() - _lastSyncAt) < 180000) return;
    doSync();
  }

  function doSync() {
    var btn = $('btn-sync');
    if (btn) btn.disabled = true;
    _syncing = true;
    renderSyncResult('サーバ時刻を自動測定中…', 'busy');
    if (!S.sync) S.sync = new CS.TimeSync();

    return S.sync.measure(location.pathname, {
      count: 12,
      onProgress: function (p) {
        renderSyncResult('測定中… ' + p.done + '/' + p.total +
          '（現在の精度 ±' + Math.round(p.uncertainty) + 'ms）', 'busy');
      }
    }).then(function (r) {
      if (btn) btn.disabled = false;
      _syncing = false;
      _lastSyncAt = Date.now();
      if (!r.ok) {
        renderSyncResult('自動同期できませんでした（Date ヘッダが読めません）。この端末の時計をそのまま使います。', 'bad');
        return;
      }
      var sign = r.offset >= 0 ? '+' : '';
      renderSyncResult(
        '自動同期済み：この端末の時計はサーバより ' + sign + r.offset + 'ms ずれています（精度 ±' + r.uncertainty +
        'ms / 往復 ' + r.rtt + 'ms / ' + r.samples + 'サンプル）。実行時にこのぶん自動補正します。',
        Math.abs(r.offset) > 1000 ? 'warn-t' : 'good');
      tickCountdown();
    }).catch(function () {
      if (btn) btn.disabled = false;
      _syncing = false;
      renderSyncResult('自動同期に失敗しました。この端末の時計をそのまま使います。', 'bad');
    });
  }

  /** 同期済みの現在時刻。未同期ならローカル時刻。 */
  function syncedNow() {
    return S.sync && S.sync.uncertainty != null ? S.sync.now() : Date.now();
  }

  /* ---- カウントダウン ---------------------------------------------- */

  function tickCountdown() {
    var el = $('countdown'), sub = $('countdown-sub');
    var ms = onSaleMs(S.plan);
    if (!S.plan.onSaleAt || isNaN(ms)) {
      el.textContent = '—';
      el.className = 'countdown';
      sub.textContent = '発売開始日時が未設定です。';
      return;
    }
    var diff = ms - syncedNow();
    if (diff <= 0) {
      el.textContent = '発売中';
      el.className = 'countdown live';
      sub.textContent = new Date(ms).toLocaleString('ja-JP') + ' に発売開始（経過済み）';
      return;
    }
    var s = Math.floor(diff / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    el.textContent = (d > 0 ? d + '日 ' : '') + pad(h) + ':' + pad(m) + ':' + pad(s);
    el.className = 'countdown' + (diff < 60000 ? ' soon' : '');
    sub.textContent = new Date(ms).toLocaleString('ja-JP') + ' 発売開始';
  }

  /* ---- 結果とカレンダー -------------------------------------------- */

  var holdTimer = null;

  function renderResult() {
    var box = $('result-body');
    clearInterval(holdTimer);

    if (!S.result) {
      updateCalendarLinks();
      if (S.logs.length) {
        box.innerHTML = '<div class="result-hero bad"><div>' +
          '<div class="result-seats">確保できませんでした</div>' +
          '<div class="result-meta">候補を増やす、打ち切り時間を延ばす、' +
          '「全候補が埋まったら空席から自動で拾う」を有効にする、などを検討してください。</div>' +
          '</div></div>';
      } else {
        box.innerHTML = '<p class="note">まだ実行していません。</p>';
      }
      return;
    }

    var r = S.result;
    var t = D.theater(S.plan.theaterId);
    var sc = currentScreen();
    var rankLabel = r.rank ? '指定した座席' : '自動選択席';
    var mark = S.rehearsal
      ? '<span class="badge">リハーサル結果 — 実際には予約されていません</span>' : '';
    box.innerHTML =
      '<div class="result-hero' + (S.rehearsal ? ' sim' : '') + '">' +
        '<div>' +
          mark +
          '<div class="result-seats">' + esc(r.seats.join('  /  ')) + '</div>' +
          '<div class="result-meta">' +
            esc((t ? t.name : '') + ' ' + (sc ? sc.name : '')) + '<br>' +
            esc(S.plan.title + ' ／ ' + S.plan.date + ' ' + S.plan.showtime + ' 開映') + '<br>' +
            rankLabel + 'で確保（発売開始から ' + Math.round(r.elapsedMs).toLocaleString() + 'ms）' +
          '</div>' +
        '</div>' +
        '<div class="hold-timer"><div class="ht-num" id="ht-num">--:--</div>' +
        '<div class="ht-lbl">' + (S.rehearsal ? '保持期限まで（' + S.plan.mock.speed + '倍速）' : '保持期限まで') +
        '</div></div>' +
      '</div>';

    function tickHold() {
      var el = $('ht-num');
      if (!el) { clearInterval(holdTimer); return; }
      var now = S.clock ? S.clock.now() : Date.now();
      var left = r.holdExpiresAt - now;
      if (left <= 0) { el.textContent = '期限切れ'; clearInterval(holdTimer); return; }
      var s = Math.floor(left / 1000);
      el.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    }
    tickHold();
    holdTimer = setInterval(tickHold, 1000);

    updateCalendarLinks();
  }

  /** 予定の開始・終了を求める */
  function eventRange() {
    var sd = showDate(S.plan);
    if (!sd) return null;
    var lead = parseInt($('c-lead').value, 10) || 0;
    var start = new Date(sd.getTime() - lead * 60000);
    var end = new Date(sd.getTime() + (S.plan.runtime || 120) * 60000);
    return { start: start, end: end, show: sd };
  }

  function utcStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  function eventFields() {
    var range = eventRange();
    if (!range) return null;
    var t = D.theater(S.plan.theaterId);
    var sc = currentScreen();
    var seats = S.result ? S.result.seats.join(' / ') : '（座席未確定）';
    var lines = [
      '作品: ' + S.plan.title,
      '劇場: ' + (t ? t.name : ''),
      'スクリーン: ' + (sc ? sc.name : ''),
      '座席: ' + seats,
      '開映: ' + S.plan.showtime,
      '枚数: ' + S.plan.count + '枚'
    ];
    return {
      title: '【映画】' + S.plan.title,
      location: t ? t.name : '',
      details: lines.join('\n'),
      start: range.start,
      end: range.end
    };
  }

  function updateCalendarLinks() {
    var f = eventFields();
    var a = $('btn-gcal');
    if (!f) { a.classList.add('off'); a.removeAttribute('href'); return; }
    a.classList.remove('off');
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(f.title) +
      '&dates=' + utcStamp(f.start) + '/' + utcStamp(f.end) +
      '&details=' + encodeURIComponent(f.details) +
      '&location=' + encodeURIComponent(f.location);
    a.href = url;
  }

  function downloadIcs() {
    var f = eventFields();
    if (!f) { toast('上映回の情報が足りません'); return; }
    var remind = parseInt($('c-remind').value, 10);
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cinema-autoreserve//JP', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + uid() + '@cinema-autoreserve',
      'DTSTAMP:' + utcStamp(new Date()),
      'DTSTART:' + utcStamp(f.start),
      'DTEND:' + utcStamp(f.end),
      'SUMMARY:' + icsEsc(f.title),
      'LOCATION:' + icsEsc(f.location),
      'DESCRIPTION:' + icsEsc(f.details),
      /* みかん（Tangerine）色。COLOR は CSS3 名（RFC7986）、X-APPLE- は Apple 用の実色。 */
      'COLOR:orangered',
      'X-APPLE-CALENDAR-COLOR:#F5511D'
    ];
    if (remind > 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + icsEsc(f.title), 'TRIGGER:-PT' + remind + 'M', 'END:VALARM');
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');

    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.plan.title || 'movie').replace(/[\\/:*?"<>|]/g, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function icsEsc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /* ---- ログイン準備チェック ----------------------------------------
     本番実行までに人間が確認しておく項目。静的サイトからは KINEZO への
     ログインを自動では試せないため、いまは手動チェックリスト。
     Phase 2 の実行体ができたら「実際にログインして確認」ボタンに置き換える。 */

  var LS_CHECKLIST = 'cinema.checklist.v1';

  var LOGIN_CHECKS = [
    { id: 'member',
      label: 'KINEZO（キネパス）の会員登録が済んでいる',
      sub: '会員登録（無料）が予約の前提。未登録なら T・ジョイのサイトから登録する' },
    { id: 'manual-login',
      label: 'T・ジョイのサイトで手動ログインできることを確認した',
      sub: 'ID・パスワードが正しいことの確認。下のボタンからサイトを開ける' },
    { id: 'drive-file',
      label: 'Google Drive の kinezo-credential にID・パスワードを書いた',
      sub: 'マイドライブ > Claude > kinezo-credential。KINEZO_ID= と KINEZO_PASSWORD= の行を実際の値に書き換える' },
    { id: 'drive-private',
      label: 'kinezo-credential を誰とも共有していない',
      sub: 'Drive の共有設定が「自分のみ」になっていることを確認' },
    { id: 'google-2fa',
      label: 'Google アカウントの2段階認証が有効になっている',
      sub: 'Drive に認証情報を置く以上、Google アカウント自体の保護が生命線' },
    { id: 'payment',
      label: '支払い方法を決めてある',
      sub: 'オンライン決済（クレジット/PayPay等）か「あとから決済」（支払期限あり・期限超過で自動キャンセル）か' },
    { id: 'password-fresh',
      label: 'パスワードを変更した場合、Drive のファイルも更新した',
      sub: '古いパスワードのままだと本番でログインに失敗する' }
  ];

  function loadChecklist() {
    try { return JSON.parse(localStorage.getItem(LS_CHECKLIST)) || {}; }
    catch (e) { return {}; }
  }

  function checklistDone() {
    var st = loadChecklist();
    return LOGIN_CHECKS.filter(function (c) { return st[c.id]; }).length;
  }

  function renderChecklist() {
    var wrap = $('login-checklist');
    if (!wrap) return;
    var st = loadChecklist();
    wrap.innerHTML = '';
    LOGIN_CHECKS.forEach(function (c) {
      var on = !!st[c.id];
      var item = document.createElement('label');
      item.className = 'check-item' + (on ? ' on' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.addEventListener('change', function () {
        var cur = loadChecklist();
        cur[c.id] = cb.checked;
        try { localStorage.setItem(LS_CHECKLIST, JSON.stringify(cur)); } catch (e) {}
        renderChecklist();
        updateRunPrecheck();
      });
      var body = document.createElement('span');
      body.innerHTML = '<span class="ci-label">' + esc(c.label) + '</span><br>' +
        '<span class="ci-sub">' + esc(c.sub) + '</span>';
      item.appendChild(cb);
      item.appendChild(body);
      wrap.appendChild(item);
    });
    var prog = $('check-progress');
    var done = checklistDone();
    prog.textContent = done + '/' + LOGIN_CHECKS.length;
    prog.classList.toggle('done', done === LOGIN_CHECKS.length);
  }

  /** 実行タブに準備状況を出す */
  function updateRunPrecheck() {
    var el = $('run-precheck');
    if (!el) return;
    el.className = 'run-precheck ok';
    el.textContent = '実際の予約は手元の runner が実行します。会員情報は runner/.env（この端末のみ）から読み込み、券種選択・決済はご自身のブラウザで行います。';
  }

  /* ---- 個人情報パネル ---------------------------------------------- */

  function writeProfile() {
    $('p-save').checked = !!S.profile.save;
    $('p-name').value = S.profile.name || '';
    $('p-tel').value = S.profile.tel || '';
    $('p-mail').value = S.profile.mail || '';
  }

  function bindProfile() {
    ['name', 'tel', 'mail'].forEach(function (k) {
      $('p-' + k).addEventListener('input', function () {
        S.profile[k] = $('p-' + k).value;
        saveProfile();
      });
    });
    $('p-save').addEventListener('change', function () {
      S.profile.save = $('p-save').checked;
      saveProfile();
      toast(S.profile.save ? 'この端末に保存します' : '保存を解除し、保存済みの内容も削除しました');
    });
    $('run-precheck').addEventListener('click', function () {
      if (!this.classList.contains('ok')) { readForm(); showView('privacy'); }
    });

    $('btn-wipe').addEventListener('click', function () {
      if (!confirm('保存済みのプランと予約者情報をすべて削除します。よろしいですか？')) return;
      localStorage.removeItem(LS_PLANS);
      localStorage.removeItem(LS_PROFILE);
      localStorage.removeItem(LS_CHECKLIST);
      localStorage.removeItem(LS_EYE);
      S.plans = [];
      S.profile = { save: false, name: '', tel: '', mail: '' };
      S.plan = blankPlan();
      writeProfile();
      writeForm();
      renderChecklist();
      updateRunPrecheck();
      toast('削除しました');
    });
  }

  /* ---- 初期化 ------------------------------------------------------ */

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.addEventListener('click', function () { readForm(); showView(b.dataset.view); });
    });

    $('theater-search').addEventListener('input', function () {
      theaterQuery = $('theater-search').value.trim();
      renderTheaterPicker();
    });
    $('btn-to-plan').addEventListener('click', function () {
      if (!S.plan.theaterId) { toast('映画館を選んでください'); return; }
      writeForm();
      showView('plan');
    });
    $('btn-to-seats').addEventListener('click', function () {
      readForm();
      if (!S.plan.title || !S.plan.date || !S.plan.showtime) {
        toast('作品と時間帯を選んでください'); return;
      }
      showView('seats');
    });
    $('btn-to-run').addEventListener('click', function () {
      if (!S.plan.candidates.length) { toast('座席を選んでください'); return; }
      showView('run');
      initCmdCard();
    });

    /* ---- 実際に予約する（コマンド生成） ---------------------------
       サイトで選んだ 作品/日付/時刻/座席 を、手元 runner の
       `node runner/reserve-hybrid.js ...` に変換する。
       座席IDは runner と同形式（例 A-3）。第2候補は " / " 区切り。 */
    function cmdQuote(s) {
      /* PowerShell / bash 双方で安全になるよう二重引用符で囲む */
      return '"' + String(s).replace(/"/g, '\\"') + '"';
    }
    function buildCmd() {
      var target = S.plan.candidates[0];
      var seatsField = $('cmd-seats');
      var seats = (seatsField && seatsField.value.trim()) || (target ? target.seats.join(',') : '');
      if (!seats || !S.plan.title || !S.plan.date || !S.plan.showtime) return null;
      var parts = ['node runner/reserve-hybrid.js'];
      /* 劇場を runner の --theater キーに変換（KINEZO 劇場パス → キー）。
         横浜は既定なので省略。対応表は runner/reserve-hybrid.js の THEATERS と揃える。 */
      var th = D.theater(S.plan.theaterId);
      /* 各劇場エントリの runnerKey をそのまま使う（チェーン共通）。横浜は runner の既定なので省略。 */
      var runnerKey = th && th.runnerKey;
      if (runnerKey && runnerKey !== 'yokohama') parts.push('--theater ' + runnerKey);
      parts.push('--date ' + S.plan.date,
        '--title ' + cmdQuote(S.plan.title),
        '--time ' + S.plan.showtime,
        '--seats ' + cmdQuote(seats));
      var atEl = $('cmd-at');
      if (atEl && atEl.value) {
        /* datetime-local は "YYYY-MM-DDTHH:MM"。日本時間として +09:00 を付ける */
        var v = atEl.value.length === 16 ? atEl.value + ':00' : atEl.value;
        parts.push('--at ' + cmdQuote(v + '+09:00'));
      }
      return parts.join(' ');
    }
    function renderCmd() {
      var out = $('cmd-out');
      if (!out) return;
      var c = buildCmd();
      out.textContent = c || '座席を確定するとコマンドが出ます。';
      out.classList.toggle('ready', !!c);
    }
    function initCmdCard() {
      var target = S.plan.candidates[0];
      var seatsField = $('cmd-seats');
      if (seatsField && target) seatsField.value = target.seats.join(',');
      renderCmd();
    }
    ['cmd-at', 'cmd-seats'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', renderCmd);
    });
    var copyBtn = $('btn-copy-cmd');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var c = buildCmd();
      if (!c) { toast('座席を確定してください'); return; }
      var done = function () { toast('コマンドをコピーしました。ターミナルに貼り付けて実行してください'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c).then(done, function () { fallbackCopy(c); done(); });
      } else { fallbackCopy(c); done(); }
    });
    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    }

    $('f-theater').addEventListener('change', function () {
      S.plan.theaterId = $('f-theater').value;
      fillScreens(S.plan.theaterId);
      S.plan.screenId = $('f-screen').value;
      S.plan.candidates = []; S.pick = [];
      updateTheaterNote(); updateTicketSum();
      updateSeatContext();
    });

    $('f-screen').addEventListener('change', function () {
      S.plan.screenId = $('f-screen').value;
      /* スクリーンが変われば座席番号の意味が変わるので候補は破棄する */
      S.plan.candidates = []; S.pick = [];
      updateTicketSum();
      updateSeatContext();
    });

    /* 作品・日時は番組表からの選択でのみ決まる（手入力欄は廃止）。
       同期用の隠しフィールドはユーザー操作では変化しない。 */

    /* 枚数は座席選択から決まる（f-count は同期用の隠しフィールド。ユーザー操作なし）。 */

    $('btn-onsale-auto').addEventListener('click', function () {
      readForm();
      var v = autoOnSale(S.plan);
      if (!v) { toast('上映日を先に入力してください'); return; }
      $('f-onsale').value = v;
      S.plan.onSaleAt = v;
      tickCountdown();
      toast('発売開始日時を設定しました');
    });

    $('f-onsale').addEventListener('input', function () { readForm(); tickCountdown(); });

    $('btn-plan-new').addEventListener('click', function () {
      S.plan = blankPlan(); S.pick = [];
      writeForm();
      toast('新しいプランを作りました');
    });

    $('btn-plan-save').addEventListener('click', function () {
      readForm();
      if (!S.plan.title) { toast('作品タイトルを入力してください'); return; }
      var i = -1;
      S.plans.forEach(function (p, k) { if (p.id === S.plan.id) i = k; });
      var copy = JSON.parse(JSON.stringify(S.plan));
      if (i >= 0) S.plans[i] = copy; else S.plans.push(copy);
      savePlans();
      renderPlanList();
      toast('保存しました');
    });

    $('btn-clear-pick').addEventListener('click', function () {
      S.pick = []; S.plan.candidates = [];
      renderSeatEditor();
    });
    $('btn-auto-pick').addEventListener('click', autoPick);

    $('btn-run-live').addEventListener('click', function () { reserveViaRunner(); });
    $('btn-run-rehearsal').addEventListener('click', function () { startRun(true); });
    $('btn-run-abort').addEventListener('click', function () { if (S.runner) S.runner.abort(); });
    $('log-verbose').addEventListener('change', redrawLog);

    ['c-lead', 'c-remind'].forEach(function (id) {
      $(id).addEventListener('input', updateCalendarLinks);
    });
    $('btn-ics').addEventListener('click', downloadIcs);
    $('btn-sync').addEventListener('click', doSync);

    bindProfile();
  }

  function init() {
    loadStore();
    fillCongestion();
    S.plan = S.plans.length ? JSON.parse(JSON.stringify(S.plans[0])) : blankPlan();
    if (!S.plan.onSaleAt) S.plan.onSaleAt = autoOnSale(S.plan);
    bind();
    writeForm();
    writeProfile();
    renderResult();
    renderTimeline(null);
    renderTheaterPicker();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    setState('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
