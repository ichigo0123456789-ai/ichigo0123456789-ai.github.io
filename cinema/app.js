/* ============================================================
   座席オートリザーブ — UI
   ------------------------------------------------------------
   プランの編集・座席の優先順位付け・実行・カレンダー連携。
   保存先はこの端末の localStorage のみで、外部への送信は行わない。
   ============================================================ */

(function () {
  'use strict';

  var D = window.CINEMA_DATA;
  var CE = window.CinemaEngine;
  var CR = window.CinemaRunner;

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
    var chain = '109';
    var theater = D.theaters.filter(function (t) { return t.chain === chain; })[0];
    var d = new Date();
    d.setDate(d.getDate() + 7);
    return {
      id: uid(),
      chain: chain,
      theaterId: theater.id,
      screenId: theater.screens[0].id,
      title: '',
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      showtime: '19:20',
      runtime: 120,
      count: 2,
      tickets: { general: 2 },
      onSaleAt: '',
      candidates: [],
      strategy: { pollIntervalMs: 1000, preconnectSec: 10, deadlineSec: 180, fallbackAny: false },
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
    ['plan', 'seats', 'run', 'result', 'privacy'].forEach(function (v) {
      $('view-' + v).classList.toggle('on', v === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
      b.classList.toggle('on', b.dataset.view === name);
    });
    if (name === 'seats') renderSeatEditor();
    if (name === 'run') renderLiveMap();
  }

  /* ---- フォーム ---------------------------------------------------- */

  function fillChains() {
    var sel = $('f-chain');
    sel.innerHTML = '';
    Object.keys(D.chains).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = D.chains[k].name;
      sel.appendChild(o);
    });
  }

  function fillTheaters(chain, selected) {
    var sel = $('f-theater');
    sel.innerHTML = '';
    D.theaters.filter(function (t) { return t.chain === chain; }).forEach(function (t) {
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
      var n = CE.expandSeats(s).length;
      var o = document.createElement('option');
      o.value = s.id; o.textContent = s.name + '（' + n + '席）';
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
    var n = 0, yen = 0;
    D.ticketTypes.forEach(function (tt) {
      var q = S.plan.tickets[tt.id] || 0;
      n += q; yen += q * tt.price;
    });
    var el = $('ticket-sum');
    var msg = '合計 ' + n + '枚 / ¥' + yen.toLocaleString();
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
    $('f-chain').value = p.chain;
    $('chain-note').textContent = D.chains[p.chain].note;
    fillTheaters(p.chain, p.theaterId);
    p.theaterId = $('f-theater').value;
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
    $('s-congestion').value = p.mock.congestion;
    $('s-seed').value = p.mock.seed;
    $('s-speed').value = p.mock.speed;

    renderPlanList();
    renderCandidates();
    updateSeatContext();
  }

  /** フォーム -> 編集中プラン */
  function readForm() {
    var p = S.plan;
    p.chain = $('f-chain').value;
    p.theaterId = $('f-theater').value;
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
        ' / ' + p.count + '枚 / 候補' + p.candidates.length + '件</div>';
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
    var seats = CE.expandSeats(screen);
    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    screen.rows.forEach(function (r) {
      var rowEl = document.createElement('div');
      rowEl.className = 'seat-row';
      var lab = document.createElement('span');
      lab.className = 'row-label';
      lab.textContent = r.label;
      rowEl.appendChild(lab);

      byRow[r.label].forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'seat' + (s.aisleAfter ? ' gap' : '') + (s.kind === 'premium' ? ' premium' : '');
        b.dataset.seat = s.id;
        b.title = s.id + (s.kind === 'premium' ? '（プレミアシート）' : '');

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
        rowEl.appendChild(b);
      });

      var lab2 = lab.cloneNode(true);
      rowEl.appendChild(lab2);
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
      (t ? t.name : '?') + ' ' + (sc ? sc.name : '?') + ' ／ ' +
      (S.plan.title || '（作品未入力）') + ' ／ ' + S.plan.date + ' ' + S.plan.showtime +
      ' ／ ' + S.plan.count + '枚';
  }

  function onSeatClick(seat, screen) {
    /* 既に候補に入っている席をクリックしたら、その候補ごと外す */
    var rank = candRankOf(seat.id);
    if (rank) {
      S.plan.candidates.splice(rank - 1, 1);
      renderCandidates();
      renderSeatEditor();
      return;
    }
    var idx = S.pick.indexOf(seat.id);
    if (idx >= 0) {
      S.pick.splice(idx, 1);
    } else if ($('opt-consecutive').checked) {
      /* クリックした席から右へ枚数分。列をはみ出す・既に埋まっている場合は取れる分だけ。 */
      var need = S.plan.count;
      var group = [];
      for (var n = seat.num; n < seat.num + need; n++) {
        var id = seat.row + '-' + n;
        var row = null;
        screen.rows.forEach(function (r) { if (r.label === seat.row) row = r; });
        if (!row || n > row.count) break;
        if (candRankOf(id)) break;
        group.push(id);
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
    renderSeatEditor();
  }

  function renderTray() {
    var el = $('tray-seats');
    if (!S.pick.length) {
      el.textContent = '座席をクリックしてください';
      el.classList.add('empty-t');
    } else {
      el.textContent = S.pick.join(' / ') + '（' + S.pick.length + '/' + S.plan.count + '）';
      el.classList.remove('empty-t');
    }
    $('btn-add-cand').disabled = S.pick.length !== S.plan.count;
  }

  /* ---- 候補 -------------------------------------------------------- */

  function seatSort(a, b) {
    var ra = a.split('-')[0], rb = b.split('-')[0];
    if (ra !== rb) return ra < rb ? -1 : 1;
    return parseInt(a.split('-')[1], 10) - parseInt(b.split('-')[1], 10);
  }

  function addCandidate(seats) {
    var sorted = seats.slice().sort(seatSort);
    var key = sorted.join(',');
    var dup = S.plan.candidates.some(function (c) {
      return c.seats.slice().sort(seatSort).join(',') === key;
    });
    if (dup) { toast('同じ座席の候補が既にあります'); return false; }
    S.plan.candidates.push({ id: uid(), seats: sorted });
    return true;
  }

  function candPopularity(c) {
    var screen = currentScreen();
    if (!screen) return 0;
    var seats = CE.expandSeats(screen);
    var byId = {};
    seats.forEach(function (s) { byId[s.id] = s; });
    var sum = 0, n = 0;
    c.seats.forEach(function (id) {
      if (byId[id]) { sum += CE.popularity(byId[id], screen); n++; }
    });
    return n ? sum / n : 0;
  }

  function renderCandidates() {
    var list = $('cand-list');
    list.innerHTML = '';
    if (!S.plan.candidates.length) {
      list.innerHTML = '<div class="empty">候補がありません。座席マップから選ぶか、「おすすめ候補を自動生成」を押してください。</div>';
      return;
    }
    S.plan.candidates.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'cand-item';
      var pop = Math.round(candPopularity(c) * 100);
      li.innerHTML =
        '<span class="cand-rank">' + (i + 1) + '</span>' +
        '<span class="cand-seats">' + esc(c.seats.join('  /  ')) + '</span>' +
        '<span class="cand-pop">人気度 ' + pop + '</span>';
      var act = document.createElement('span');
      act.className = 'cand-actions';

      var up = document.createElement('button');
      up.textContent = '↑'; up.title = '優先順位を上げる'; up.disabled = i === 0;
      up.addEventListener('click', function () { move(i, -1); });

      var down = document.createElement('button');
      down.textContent = '↓'; down.title = '優先順位を下げる';
      down.disabled = i === S.plan.candidates.length - 1;
      down.addEventListener('click', function () { move(i, 1); });

      var del = document.createElement('button');
      del.className = 'del'; del.textContent = '削除';
      del.addEventListener('click', function () {
        S.plan.candidates.splice(i, 1);
        renderCandidates(); renderSeatEditor();
      });

      act.appendChild(up); act.appendChild(down); act.appendChild(del);
      li.appendChild(act);
      list.appendChild(li);
    });
  }

  function move(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= S.plan.candidates.length) return;
    var tmp = S.plan.candidates[i];
    S.plan.candidates[i] = S.plan.candidates[j];
    S.plan.candidates[j] = tmp;
    renderCandidates();
    renderSeatEditor();
  }

  /** 人気度の高い連席を上位から拾って候補にする */
  function autoCandidates(limit) {
    var screen = currentScreen();
    if (!screen) return;
    var need = S.plan.count;
    var seats = CE.expandSeats(screen);
    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    var groups = [];
    Object.keys(byRow).forEach(function (rowLabel) {
      var list = byRow[rowLabel].slice().sort(function (a, b) { return a.num - b.num; });
      for (var i = 0; i + need <= list.length; i++) {
        var g = list.slice(i, i + need), ok = true, score = 0;
        for (var j = 0; j < g.length; j++) {
          if (j > 0 && g[j].num !== g[j - 1].num + 1) { ok = false; break; }
          score += CE.popularity(g[j], screen);
        }
        if (!ok) continue;
        groups.push({ seats: g.map(function (s) { return s.id; }), score: score / need });
      }
    });
    groups.sort(function (a, b) { return b.score - a.score; });

    /* 席が重なる候補ばかりになると「次の候補」の意味が無いので、
       既に採用した席を含むグループは飛ばす。 */
    var used = {};
    S.plan.candidates.forEach(function (c) { c.seats.forEach(function (s) { used[s] = 1; }); });
    var added = 0;
    for (var k = 0; k < groups.length && added < limit; k++) {
      var g = groups[k];
      if (g.seats.some(function (s) { return used[s]; })) continue;
      if (addCandidate(g.seats)) {
        g.seats.forEach(function (s) { used[s] = 1; });
        added++;
      }
    }
    renderCandidates();
    renderSeatEditor();
    toast(added + '件の候補を追加しました');
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
    if (!S.plan.candidates.length) return '座席の候補を1件以上登録してください';
    var bad = S.plan.candidates.filter(function (c) { return c.seats.length !== S.plan.count; });
    if (bad.length) return '枚数（' + S.plan.count + '枚）と席数が違う候補があります';
    return null;
  }

  function startRun(rehearsal) {
    var err = validateForRun();
    if (err) { toast(err); return; }

    var screen = currentScreen();
    S.logs = [];
    S.result = null;
    $('log').innerHTML = '';

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

    var clock = new CR.Clock({ speed: speed, base: base });
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

    if (rehearsal) {
      pushLog({
        rel: (base - onSale) / 1000,
        level: 'warn',
        msg: '── リハーサル（' + speed + '倍速・モック環境）──'
      });
    }
    S.runner.run();
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
    var diff = ms - Date.now();
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
    var rankLabel = r.rank ? '第' + r.rank + '候補' : '自動選択席';
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
            rankLabel + 'で確保（発売開始から ' + r.elapsedSec.toFixed(1) + '秒）' +
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

    $('f-chain').addEventListener('change', function () {
      S.plan.chain = $('f-chain').value;
      $('chain-note').textContent = D.chains[S.plan.chain].note;
      fillTheaters(S.plan.chain);
      S.plan.theaterId = $('f-theater').value;
      fillScreens(S.plan.theaterId);
      S.plan.screenId = $('f-screen').value;
      S.plan.candidates = []; S.pick = [];
      renderCandidates(); updateSeatContext();
    });

    $('f-theater').addEventListener('change', function () {
      S.plan.theaterId = $('f-theater').value;
      fillScreens(S.plan.theaterId);
      S.plan.screenId = $('f-screen').value;
      S.plan.candidates = []; S.pick = [];
      renderCandidates(); updateSeatContext();
    });

    $('f-screen').addEventListener('change', function () {
      S.plan.screenId = $('f-screen').value;
      /* スクリーンが変われば座席番号の意味が変わるので候補は破棄する */
      S.plan.candidates = []; S.pick = [];
      renderCandidates(); updateSeatContext();
    });

    ['f-title', 'f-date', 'f-time', 'f-runtime'].forEach(function (id) {
      $(id).addEventListener('input', function () { readForm(); updateSeatContext(); });
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
    $('btn-add-cand').addEventListener('click', function () {
      if (addCandidate(S.pick)) { S.pick = []; renderCandidates(); renderSeatEditor(); }
    });
    $('btn-clear-pick').addEventListener('click', function () { S.pick = []; renderSeatEditor(); });
    $('btn-clear-cands').addEventListener('click', function () {
      S.plan.candidates = []; S.pick = [];
      renderCandidates(); renderSeatEditor();
    });
    $('btn-auto-cands').addEventListener('click', function () { autoCandidates(5); });

    $('btn-run-live').addEventListener('click', function () { startRun(false); });
    $('btn-run-rehearsal').addEventListener('click', function () { startRun(true); });
    $('btn-run-abort').addEventListener('click', function () { if (S.runner) S.runner.abort(); });
    $('log-verbose').addEventListener('change', redrawLog);

    ['c-lead', 'c-remind'].forEach(function (id) {
      $(id).addEventListener('input', updateCalendarLinks);
    });
    $('btn-ics').addEventListener('click', downloadIcs);

    bindProfile();
  }

  function init() {
    loadStore();
    fillChains();
    fillCongestion();
    S.plan = S.plans.length ? JSON.parse(JSON.stringify(S.plans[0])) : blankPlan();
    if (!S.plan.onSaleAt) S.plan.onSaleAt = autoOnSale(S.plan);
    bind();
    writeForm();
    writeProfile();
    renderResult();
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
