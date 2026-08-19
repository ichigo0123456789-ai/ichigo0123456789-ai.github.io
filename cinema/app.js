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
    var rule = D.chains[plan.chain].onSaleRule;
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
    if (name === 'seats') renderSeatEditor();
    if (name === 'run') renderLiveMap();
    window.scrollTo(0, 0);
  }

  /* ---- ① 劇場選択 --------------------------------------------------

     検索と全国マップの両方から選べる。いまは T・ジョイ横浜の1館だけだが、
     データを足せばそのまま並ぶ構造にしてある。 */

  var theaterQuery = '';

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
    renderTheaterPicker();
    $('btn-to-plan').disabled = false;
  }

  function renderTheaterPicker() {
    var list = $('theater-list');
    list.innerHTML = '';
    var shown = D.theaters.filter(function (t) { return theaterMatches(t, theaterQuery); });

    if (!shown.length) {
      list.innerHTML = '<div class="theater-empty">「' + esc(theaterQuery) +
        '」に一致する対応劇場はありません。<br>現在対応しているのは T・ジョイ横浜のみです。</div>';
    }
    shown.forEach(function (t) {
      var on = t.id === S.plan.theaterId;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'theater-item' + (on ? ' on' : '');
      b.innerHTML =
        '<span class="ti-pin"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>' +
        '<span><span class="ti-name">' + esc(t.name) + '</span><br>' +
        '<span class="ti-meta">' + esc((t.pref ? t.pref + ' ／ ' : '') + (t.station || t.area)) + '<br>' +
        esc(t.note || '') + '</span>' +
        '<span class="ti-badge">' + esc(D.chains[t.chain].name) + '</span></span>';
      b.addEventListener('click', function () { selectTheater(t.id); });
      list.appendChild(b);
    });

    renderMapPins();
    $('btn-to-plan').disabled = !S.plan.theaterId;
  }

  function renderMapPins() {
    var g = $('map-pins');
    if (!g) return;
    g.innerHTML = '';
    var SVG = 'http://www.w3.org/2000/svg';
    D.theaters.forEach(function (t) {
      if (!t.map) return;
      var on = t.id === S.plan.theaterId;
      var pin = document.createElementNS(SVG, 'g');
      pin.setAttribute('class', 'map-pin' + (on ? ' on' : ''));
      pin.setAttribute('role', 'button');
      pin.setAttribute('aria-label', t.name);

      var ring = document.createElementNS(SVG, 'circle');
      ring.setAttribute('class', 'ring');
      ring.setAttribute('cx', t.map.x); ring.setAttribute('cy', t.map.y);
      ring.setAttribute('r', on ? 30 : 20);
      var core = document.createElementNS(SVG, 'circle');
      core.setAttribute('class', 'core');
      core.setAttribute('cx', t.map.x); core.setAttribute('cy', t.map.y);
      core.setAttribute('r', 8);
      var label = document.createElementNS(SVG, 'text');
      label.setAttribute('x', t.map.x + 38); label.setAttribute('y', t.map.y + 9);
      label.textContent = t.name;

      pin.appendChild(ring); pin.appendChild(core); pin.appendChild(label);
      pin.addEventListener('click', function () { selectTheater(t.id); });
      g.appendChild(pin);
    });
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
        chip.className = 'date-chip' + (ds === scheduleDate ? ' on' : '');
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

  function renderSchedule() {
    var wrap = $('schedule-list');
    wrap.innerHTML = '';
    var t = D.theater(S.plan.theaterId);
    if (!t) {
      wrap.innerHTML = '<div class="empty">先に映画館を選んでください（手順1）。</div>';
      return;
    }
    var sched = window.CINEMA_SCHEDULE.forDate(t, scheduleDate);

    sched.movies.forEach(function (entry) {
      var m = entry.movie;
      var block = document.createElement('div');
      block.className = 'movie-block';

      var head = document.createElement('div');
      head.className = 'movie-head';
      head.innerHTML =
        '<span class="movie-title">' + esc(m.title) + '</span>' +
        (entry.shows.some(function (x) { return x.format; })
          ? '<span class="movie-badge">DOLBY CINEMA</span>' : '') +
        '<span class="movie-meta">' + m.runtime + '分 ／ ' + esc(m.rating) + ' ／ ' + esc(m.tag) + '</span>';
      block.appendChild(head);

      var row = document.createElement('div');
      row.className = 'show-row';
      entry.shows.forEach(function (show) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'show-btn' + (isSelectedShow(m, show) ? ' on' : '');
        b.disabled = show.status === 'soldout';
        b.innerHTML =
          '<span class="show-time">' + show.time + ' <small>〜' + show.endTime + '</small></span>' +
          '<span class="show-sub">' + esc(show.screenName) + ' ' + STATUS_LABEL[show.status] + '</span>';
        if (!b.disabled) {
          b.addEventListener('click', function () { selectShow(m, show); });
        }
        row.appendChild(b);
      });
      block.appendChild(row);
      wrap.appendChild(block);
    });

    var note = document.createElement('p');
    note.className = 'sched-note';
    note.textContent = sched.onSale
      ? '◎=空席あり ／ この日の回は発売中です'
      : 'この日の回はまだ発売前です（発売は上映日の2日前 0:00）。時間帯を選んでおくと、発売と同時に確保を試みます。';
    wrap.appendChild(note);
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
    $('f-count').value = p.count;
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
    p.screenId = $('f-screen').value;
    p.title = $('f-title').value.trim();
    p.date = $('f-date').value;
    p.showtime = $('f-time').value;
    p.runtime = parseInt($('f-runtime').value, 10) || 120;
    p.onSaleAt = $('f-onsale').value;
    p.count = Math.max(1, parseInt($('f-count').value, 10) || 1);
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

    /* 座席表はブロック幅そのままのグリッドで描く。縦通路はブロックとブロックの
       あいだの1本の隙間カラムなので、席の少ない列（シアター4のA・B・K列など）も
       公式の座席表と同じ位置に並ぶ。
       A列のように前後の列と半席ずれる列があるため、グリッドは半席刻みで敷き、
       席1つは2カラムぶんを占める。 */
    var widths = screen.blockWidths;
    var template = widths.map(function (w) {
      return 'repeat(' + (w * 2) + ', var(--seat-half))';
    }).join(' var(--aisle) ');

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
      grid.style.gridTemplateColumns = template;

      byRow[r.label].forEach(function (s) {
        var b = document.createElement('button');
        var wc = !CE.isSelectable(s);
        b.className = 'seat';
        b.dataset.seat = s.id;
        /* ブロックの前に縦通路のカラムがそのぶん挟まる */
        b.style.gridColumn = (s.col * 2 + s.block + 1) + ' / span ' + 2 * (wc ? s.span : 1);
        b.title = s.id + (wc ? '（車椅子スペース）' : '');

        if (wc) {
          /* 車椅子スペースは一般の座席選択では選べない */
          b.dataset.st = 'wc';
          b.disabled = true;
          b.textContent = '♿';
          grid.appendChild(b);
          return;
        }

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

  function renderSeatEditor() {
    updateSeatContext();
    renderSeatmap($('seatmap'), false);
    renderTray();
  }

  function renderLiveMap() {
    renderSeatmap($('seatmap-live'), true);
  }

  function updateSeatContext() {
    var t = D.theater(S.plan.theaterId);
    var sc = currentScreen();
    $('seat-context').textContent =
      (t ? t.name : '?') + ' ' + (sc ? sc.name + (sc.format ? '（' + sc.format + '）' : '') : '?') + ' ／ ' +
      (S.plan.title || '（作品未入力）') + ' ／ ' + S.plan.date + ' ' + S.plan.showtime +
      ' ／ ' + S.plan.count + '枚';
  }

  function onSeatClick(seat, screen) {
    /* 確保対象の席をクリックしたら選び直し */
    if (candRankOf(seat.id)) {
      S.plan.candidates = [];
      S.pick = [];
      renderSeatEditor();
      return;
    }
    var idx = S.pick.indexOf(seat.id);
    if (idx >= 0) {
      S.pick.splice(idx, 1);
    } else if ($('opt-consecutive').checked) {
      /* クリックした席から右へ枚数分。縦通路をまたぐ・列をはみ出す場合は取れる分だけ。 */
      var need = S.plan.count;
      var group = [];
      var rowSeats = CE.expandSeats(screen).filter(function (s) { return s.row === seat.row; });
      for (var k = 0; k < need; k++) {
        var next = null;
        for (var i = 0; i < rowSeats.length; i++) {
          if (rowSeats[i].num === seat.num + k) { next = rowSeats[i]; break; }
        }
        /* 番号が続いていても別ブロックなら隣り合っていない */
        if (!next || next.block !== seat.block) break;
        if (!CE.isSelectable(next)) break;
        if (candRankOf(next.id)) break;
        group.push(next.id);
      }
      if (group.length < need) {
        toast('その位置からは' + need + '席ぶん連続で取れません');
        return;
      }
      S.pick = group;
    } else {
      if (S.pick.length >= S.plan.count) {
        toast('枚数（' + S.plan.count + '枚）ぶん選択済みです');
        return;
      }
      S.pick.push(seat.id);
    }
    /* 枚数分そろったら、そのまま確保対象として確定する。
       優先順位を付けないので、候補は常に0件か1件。 */
    if (S.pick.length === S.plan.count) {
      S.plan.candidates = [{ id: 'target', seats: S.pick.slice().sort(seatSort) }];
      S.pick = [];
    }
    renderSeatEditor();
  }

  function renderTray() {
    var el = $('tray-seats');
    var target = S.plan.candidates[0];
    var nextBtn = $('btn-to-run');
    if (nextBtn) nextBtn.disabled = !target;
    if (target) {
      el.textContent = target.seats.join('  /  ');
      el.classList.remove('empty-t');
      el.classList.add('confirmed');
    } else if (S.pick.length) {
      el.textContent = S.pick.join(' / ') + '（あと' + (S.plan.count - S.pick.length) + '席）';
      el.classList.remove('empty-t', 'confirmed');
    } else {
      el.textContent = '座席表からクリックして選んでください';
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
   * 中央の見やすい連席を1組だけ選ぶ。
   * 優先順位を付けないので、返すのは常に最良の1組。
   */
  function autoPick() {
    var screen = currentScreen();
    if (!screen) return;
    var need = S.plan.count;
    var seats = CE.expandSeats(screen);
    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    var best = null, bestScore = -1;
    Object.keys(byRow).forEach(function (rowLabel) {
      var list = byRow[rowLabel].slice().sort(function (a, b) { return a.num - b.num; });
      for (var i = 0; i + need <= list.length; i++) {
        var g = list.slice(i, i + need), ok = true, score = 0;
        for (var j = 0; j < g.length; j++) {
          /* 縦通路をまたいだ組は連席とみなさない */
          if (j > 0 && (g[j].num !== g[j - 1].num + 1 || g[j].block !== g[j - 1].block)) { ok = false; break; }
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
      toast('発売開始日時が過去です。本番実行はできません（リハーサルは可能です）');
      return;
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

  function doSync() {
    var btn = $('btn-sync');
    btn.disabled = true;
    renderSyncResult('測定中…', 'busy');
    if (!S.sync) S.sync = new CS.TimeSync();

    return S.sync.measure(location.pathname, {
      count: 12,
      onProgress: function (p) {
        renderSyncResult('測定中… ' + p.done + '/' + p.total +
          '（現在の精度 ±' + Math.round(p.uncertainty) + 'ms）', 'busy');
      }
    }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) {
        renderSyncResult('同期できませんでした（Date ヘッダが読めません）。この端末の時計をそのまま使います。', 'bad');
        return;
      }
      var sign = r.offset >= 0 ? '+' : '';
      renderSyncResult(
        'この端末の時計はサーバより ' + sign + r.offset + 'ms ずれています（精度 ±' + r.uncertainty +
        'ms / 往復 ' + r.rtt + 'ms / ' + r.samples + 'サンプル）。実行時にこのぶん補正します。',
        Math.abs(r.offset) > 1000 ? 'warn-t' : 'good');
      tickCountdown();
    }).catch(function () {
      btn.disabled = false;
      renderSyncResult('同期に失敗しました。この端末の時計をそのまま使います。', 'bad');
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
      title: '🎬 ' + S.plan.title + '（' + (t ? t.name : '') + '）',
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
      'DESCRIPTION:' + icsEsc(f.details)
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
    $('btn-wipe').addEventListener('click', function () {
      if (!confirm('保存済みのプランと予約者情報をすべて削除します。よろしいですか？')) return;
      localStorage.removeItem(LS_PLANS);
      localStorage.removeItem(LS_PROFILE);
      S.plans = [];
      S.profile = { save: false, name: '', tel: '', mail: '' };
      S.plan = blankPlan();
      writeProfile();
      writeForm();
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
    });

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

    ['f-title', 'f-date', 'f-time', 'f-runtime'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        readForm();
        updateSeatContext();
        renderPlanSelbar();
        if (id === 'f-date' && S.plan.date) { scheduleDate = S.plan.date; renderDateStrip(); renderSchedule(); }
      });
    });

    $('f-count').addEventListener('input', function () {
      readForm();
      S.pick = [];
      updateSeatContext(); renderTray(); updateTicketSum();
    });

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

    $('opt-consecutive').addEventListener('change', function () { S.pick = []; renderSeatEditor(); });
    $('btn-clear-pick').addEventListener('click', function () {
      S.pick = []; S.plan.candidates = [];
      renderSeatEditor();
    });
    $('btn-auto-pick').addEventListener('click', autoPick);

    $('btn-run-live').addEventListener('click', function () { startRun(false); });
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
