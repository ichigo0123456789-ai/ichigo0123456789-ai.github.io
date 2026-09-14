// ============================================================
//  app.js — 最速ゲット作戦室のロジック💪
//  やってること:
//   1. GitHub Pages の Date ヘッダで時刻同期（PCの時計ズレてても平気）
//   2. ms単位カウントダウン + 音 + 自動/手動発射
//   3. getCoupon リンクを一気にタブで開く（ログイン済みならそのまま獲得）
//   4. ログとチェックリストは localStorage に保存
// ============================================================
(function () {
  "use strict";
  const CFG = window.COUPON_CONFIG;
  const C = CFG.campaign;
  const $ = (s) => document.querySelector(s);
  const LS = "rc_kumamoto_v1";

  // ---------- 状態 ----------
  const state = {
    offset: 0,          // serverNow = Date.now() + offset
    acc: null,          // 同期精度(ms) null=未同期
    synced: false,
    target: Date.parse(C.startJST),   // 本番の解禁時刻(ms)
    practice: null,     // リハーサル中の仮解禁時刻
    fired: false,       // 本番発射済みか（自動発射の二重防止）
    sound: false,
    audio: null,
    beeped: {},         // 何秒前のビープを鳴らしたか
    popupOk: null,      // ポップアップテスト結果
    autoOk: null,       // クリックなしで開けるか
    wakeLock: null
  };
  const saved = load();

  // ---------- ユーティリティ ----------
  function load() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (e) { /* プライベートモードとかは無視でOK */ } }
  const serverNow = () => Date.now() + state.offset;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  // JST表示用（ユーザーのタイムゾーン関係なく日本時間で出す）
  function fmtJST(ms, withMs) {
    const d = new Date(ms + 9 * 3600 * 1000);
    let s = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
    if (withMs) s += "." + pad(d.getUTCMilliseconds(), 3);
    return s;
  }
  function log(msg, cls) {
    const el = $("#log");
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = "[" + fmtJST(serverNow(), true) + "] " + msg;
    el.prepend(line);
    saved.log = [line.outerHTML].concat(saved.log || []).slice(0, 60);
    save();
  }
  function flash() { const f = $("#flash"); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }

  // ---------- 時刻同期 ----------
  // 同じオリジン(GitHub Pages)に HEAD を連打して Date ヘッダの「秒が切り替わる瞬間」を捕まえる。
  // Date ヘッダは秒精度だけど、切り替わりを捕まえれば ±(リクエスト間隔/2 + RTT/2) くらいまで詰まるっしょ
  async function sample() {
    const url = location.pathname + "?_=" + Math.random().toString(36).slice(2);
    const t0 = Date.now();
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    const t1 = Date.now();
    const h = r.headers.get("date");
    if (!h) throw new Error("no date header");
    const d = Date.parse(h);
    if (isNaN(d)) throw new Error("bad date header");
    return { t0, t1, mid: (t0 + t1) / 2, rtt: t1 - t0, d };
  }
  async function syncClock(quiet) {
    const badge = $("#syncBadge");
    badge.className = "badge"; badge.textContent = "時刻同期中…";
    if (location.protocol === "file:") {
      badge.className = "badge warn"; badge.textContent = "ローカル時計（file:// なので同期不可）";
      state.synced = false; state.acc = null; return;
    }
    try {
      const samples = [];
      const start = Date.now();
      let found = null;
      while (Date.now() - start < 2600) {
        const s = await sample();
        const prev = samples[samples.length - 1];
        samples.push(s);
        if (prev && s.d > prev.d) {
          // 秒の境界を prev と s の間で跨いだ。境界のローカル時刻は2つの中点あたり
          const boundaryLocal = (prev.mid + s.mid) / 2;
          const err = (s.mid - prev.mid) / 2 + s.rtt / 2;
          found = { offset: s.d - boundaryLocal, acc: Math.round(err) };
          // もう1回境界を取れると更に精度上がるけど、時間かかるのでここで打ち切り
          break;
        }
      }
      if (!found) {
        // 境界が取れなかった（回線遅すぎ等）→ RTT最小のサンプルで秒精度の粗い同期
        const best = samples.reduce((a, b) => (a.rtt <= b.rtt ? a : b));
        found = { offset: best.d + 500 - best.mid, acc: 500 + Math.round(best.rtt / 2) };
      }
      state.offset = found.offset; state.acc = found.acc; state.synced = true;
      badge.className = "badge ok"; badge.textContent = "時刻同期OK ±" + found.acc + "ms";
      if (!quiet) log("時刻同期OK: PC時計とのズレ " + (found.offset > 0 ? "+" : "") + Math.round(found.offset) + "ms（精度±" + found.acc + "ms、サンプル" + samples.length + "件）", "ok");
    } catch (e) {
      state.synced = false; state.acc = null; state.offset = 0;
      badge.className = "badge bad"; badge.textContent = "同期失敗→PC時計を使用";
      log("時刻同期に失敗、PCの時計で動くよ: " + e.message, "bad");
    }
  }

  // ---------- 音 ----------
  function ensureAudio() {
    if (!state.audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      state.audio = new AC();
    }
    if (state.audio.state === "suspended") state.audio.resume();
    return state.audio;
  }
  function beep(freq, dur, vol) {
    if (!state.sound) return;
    const ac = ensureAudio(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.value = vol || 0.15;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + (dur || 0.08));
  }

  // ---------- クーポン一覧 ----------
  const order = () => {
    const list = CFG.coupons.slice();
    if ($("#scarceFirst").checked) list.sort((a, b) => a.cap - b.cap || a.priority - b.priority);
    else list.sort((a, b) => a.priority - b.priority);
    return list;
  };
  const cUrl = (c) => "https://coupon.rakuten.co.jp/getCoupon?getkey=" + c.key;
  function renderCoupons() {
    const box = $("#coupons"); box.innerHTML = "";
    let g = null;
    const sel = saved.sel || {};
    CFG.coupons.slice().sort((a, b) => a.priority - b.priority).forEach((c, i) => {
      if (c.group !== g) { g = c.group; const h = document.createElement("div"); h.className = "cgroup"; h.textContent = g; box.appendChild(h); }
      const on = (c.id in sel) ? sel[c.id] : c.defaultOn;
      const el = document.createElement("div");
      el.className = "coupon" + (c.cap <= 200 ? " scarce" : "");
      el.dataset.id = c.id;
      el.innerHTML =
        '<input type="checkbox" ' + (on ? "checked" : "") + ' title="GOで開く対象にする">' +
        '<div><div class="name"><span class="kbd">' + (i + 1) + '</span> ' + c.title + '<span class="price">' + c.price + '</span>' + (c.cap <= 200 ? '<span class="scarcetag">激戦 ' + c.cap + '枚</span>' : "") + '</div>' +
        '<div class="sub">' + c.sub + '</div><div class="cond">' + c.cond + '</div><div class="st" data-st></div></div>' +
        '<div class="actions"><a class="btn sm ' + (c.alreadyOpen ? "lime" : "primary") + '" target="_blank" rel="noopener" href="' + cUrl(c) + '">' + (c.alreadyOpen ? "今すぐ獲得" : "獲得ページ") + '</a></div>';
      el.querySelector("input").addEventListener("change", (e) => { saved.sel = saved.sel || {}; saved.sel[c.id] = e.target.checked; save(); });
      el.querySelector("a").addEventListener("click", () => log("個別に開いた: " + c.title, "hi"));
      box.appendChild(el);
    });
  }
  function selected() {
    const ids = new Set([...document.querySelectorAll("#coupons .coupon")].filter((el) => el.querySelector("input").checked).map((el) => el.dataset.id));
    return order().filter((c) => ids.has(c.id));
  }
  function setStatus(c, txt, cls) {
    const el = document.querySelector('#coupons .coupon[data-id="' + c.id + '"] [data-st]');
    if (el) { el.textContent = txt; el.className = "st " + (cls || ""); }
  }

  // ---------- 発射 ----------
  // window.open を同期で連打。ブロックされると null が返るので拾う
  function openAll(list, urlFn, label) {
    const t = serverNow();
    const tgt = state.practice || state.target;
    const delta = t - tgt;
    log(label + "発射！ 解禁との差 " + (delta >= 0 ? "+" : "") + delta + "ms（" + list.length + "件）", "gold");
    let blocked = 0;
    list.forEach((c, i) => {
      const w = window.open(urlFn(c), "_blank");
      if (w) { setStatus(c, "開いた " + fmtJST(serverNow(), true), "ok"); }
      else { blocked++; setStatus(c, "ブロックされた→右のボタンで手動", "bad"); }
    });
    if (blocked) {
      log(blocked + "件がポップアップブロックされた！右の「獲得ページ」ボタンを順に押して！", "bad");
      showPopupAlert("⚠️ " + blocked + "件ブロックされた。各クーポンの「獲得ページ」ボタンを上から順にクリック！（次回のためにブラウザでこのサイトのポップアップを「許可」にしてね）");
    } else {
      log("全部開いた。各タブが「獲得しました」になってるか確認→即予約へ！", "ok");
    }
    flash(); beep(1320, 0.25, 0.25);
    return blocked === 0;
  }
  function fireReal(label) {
    const list = selected();
    if (!list.length) { log("チェックされたクーポンがない！", "bad"); return; }
    state.fired = true;
    $("#go").classList.add("fired"); $("#go").innerHTML = "発射済み ✔<small>各タブの結果を確認して予約へ！もう一回押せば再発射</small>";
    openAll(list, cUrl, label || "");
  }
  function firePractice() {
    const list = selected();
    openAll(list, () => "about:blank", "【リハ】");
    state.practice = null;
    $("#go").classList.add("fired"); $("#go").innerHTML = "リハ完了 ✔<small>ログで反応速度チェック。about:blank を開いただけだから閉じてOK</small>";
    setTimeout(resetGoLabel, 4000);
  }
  function resetGoLabel() {
    if (state.fired) return;
    $("#go").classList.remove("fired");
    $("#go").innerHTML = '全部獲得 GO!<small>解禁になったら押せるよ／<span class="kbd">Space</span> でも発射</small>';
  }
  function showPopupAlert(msg) { const a = $("#popupAlert"); a.hidden = false; a.textContent = msg; }

  // ---------- カウントダウンループ ----------
  function tick() {
    const now = serverNow();
    const tgt = state.practice || state.target;
    const fly = Number($("#fly").value) || 0;
    const rem = tgt - now;               // 解禁までの残り
    const armAt = fly;                   // rem <= fly で押せる
    const cnt = $("#count"), ph = $("#phase"), go = $("#go");

    // 表示
    const a = Math.abs(rem);
    const h = Math.floor(a / 3600000), m = Math.floor(a / 60000) % 60, s = Math.floor(a / 1000) % 60, ms = a % 1000;
    cnt.innerHTML = (rem < 0 ? "+" : "") + (h ? pad(h) + ":" : "") + pad(m) + ":" + pad(s) + '<span class="ms">.' + pad(ms, 3) + "</span>";
    cnt.className = "count" + (rem <= 0 ? " go" : rem <= 10000 ? " hot" : "");
    $("#srvNow").textContent = fmtJST(now, true);
    $("#offset").textContent = state.synced ? ((state.offset > 0 ? "+" : "") + Math.round(state.offset) + "ms") : "未同期";
    $("#acc").textContent = state.acc != null ? "±" + state.acc + "ms" : "--";

    if (state.practice) ph.textContent = rem > 0 ? "🎯 リハーサル中… " : "🎯 リハ解禁！押せ！";
    else if (rem > 600000) ph.textContent = "まだ余裕。チェックリスト消化タイム☕";
    else if (rem > 60000) ph.textContent = "10分切った！ログイン確認・タブ温め！";
    else if (rem > 10000) ph.textContent = "1分切った！指をGOボタンに置いて待機🫵";
    else if (rem > 0) ph.textContent = "カウントダウン… " + Math.ceil(rem / 1000);
    else if (rem > -300000) ph.textContent = "🔥 解禁中！！GO GO GO！！";
    else ph.textContent = "解禁から時間経過。まだ残ってるかも、取ってなければGO";

    // ボタンの活性
    const armed = rem <= armAt;
    go.disabled = !armed;
    go.classList.toggle("armed", armed && !state.fired && !(go.classList.contains("fired")));

    // ビープ（10,5,4,3,2,1 秒前と0）
    if (rem > 0 && rem <= 10500) {
      const sec = Math.ceil(rem / 1000);
      const key = (state.practice ? "p" : "r") + sec;
      if ((sec === 10 || sec <= 5) && !state.beeped[key]) { state.beeped[key] = 1; beep(sec <= 3 ? 990 : 660, 0.09, 0.2); }
    }

    // 自動発射（本番のみ、二重発射ナシ）
    if (!state.practice && !state.fired && $("#auto").checked && armed && rem > -120000) {
      fireReal("【自動】");
    }
    // リハの自動発射はしない（クリック練習が目的だから）

    requestAnimationFrame(tick);
  }

  // ---------- イベント ----------
  function bind() {
    // リンク類
    $("#loginLink").href = C.loginCheck; $("#myCoupon").href = C.myCoupon; $("#howto").href = C.howto;
    $("#pageLink").href = C.page; $("#pkgLink").href = C.packagePage;
    $("#hotels1").href = C.hotels1; $("#hotels2").href = C.hotels2;
    const ana = CFG.coupons.find((c) => c.alreadyOpen); if (ana) $("#anaNow").href = cUrl(ana);

    // チェックリスト（保存）
    document.querySelectorAll("#checklist li").forEach((li) => {
      const k = li.dataset.k, cb = li.querySelector("input");
      cb.checked = !!(saved.check && saved.check[k]); li.classList.toggle("done", cb.checked);
      cb.addEventListener("change", () => { saved.check = saved.check || {}; saved.check[k] = cb.checked; li.classList.toggle("done", cb.checked); save(); });
    });
    const markDone = (k) => { const li = document.querySelector('#checklist li[data-k="' + k + '"]'); if (li) { li.querySelector("input").checked = true; li.classList.add("done"); saved.check = saved.check || {}; saved.check[k] = true; save(); } };
    $("#loginLink").addEventListener("click", () => { log("ログイン確認ページを開いた。一覧が見えたらチェック入れてね", "hi"); });
    $("#anaNow").addEventListener("click", () => { log("ANA 15,000円クーポンの獲得ページを開いた", "hi"); markDone("ana"); });
    $("#pageLink").addEventListener("click", () => markDone("prewarm"));

    // 設定の保存
    ["fly", "auto", "scarceFirst"].forEach((id) => {
      const el = $("#" + id);
      if (saved.opt && id in saved.opt) { if (el.type === "checkbox") el.checked = saved.opt[id]; else el.value = saved.opt[id]; }
      el.addEventListener("change", () => { saved.opt = saved.opt || {}; saved.opt[id] = el.type === "checkbox" ? el.checked : el.value; save();
        if (id === "auto" && el.checked && state.autoOk !== true) showPopupAlert("自動発射はブラウザでこのサイトのポップアップを許可してないと弾かれる。上の「自動発射テスト」で確認してね！"); });
    });

    // GO
    $("#go").addEventListener("click", () => { ensureAudio(); state.practice ? firePractice() : fireReal(); });
    $("#forceGo").addEventListener("click", () => { ensureAudio(); if (state.practice) { firePractice(); } else { fireReal("【強制】"); } });
    document.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); if (!$("#go").disabled) $("#go").click(); else { beep(220, 0.1, 0.1); log("まだ解禁前！GOボタンが点灯するまで待って（強制GOは別ボタン）", "bad"); } }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        const c = CFG.coupons.slice().sort((a, b) => a.priority - b.priority)[n - 1];
        if (c) { const w = window.open(cUrl(c), "_blank"); setStatus(c, w ? "開いた " + fmtJST(serverNow(), true) : "ブロックされた", w ? "ok" : "bad"); log("キー" + n + ": " + c.title + (w ? " を開いた" : " がブロックされた"), w ? "hi" : "bad"); }
      }
    });

    // リハーサル：15秒後に仮解禁。about:blank を開く（本物は叩かない）
    $("#practice").addEventListener("click", () => {
      ensureAudio();
      state.practice = serverNow() + 15000; state.beeped = {};
      $("#go").classList.remove("fired"); resetGoLabel();
      log("リハーサル開始！15秒後に仮解禁。GOボタン（かSpace）を最速で押せ！", "gold");
    });
    $("#resync").addEventListener("click", () => syncClock(false));

    // 音
    $("#soundBtn").addEventListener("click", () => {
      state.sound = !state.sound; ensureAudio();
      $("#soundBadge").textContent = "音 " + (state.sound ? "ON" : "OFF"); $("#soundBadge").className = "badge" + (state.sound ? " ok" : "");
      $("#soundBtn").textContent = state.sound ? "🔕 音をOFF" : "🔔 音をON";
      if (state.sound) { beep(880, 0.1, 0.2); markDone("sound"); }
    });

    // ポップアップテスト：クリック内で3つ同期に開く
    $("#popupTest").addEventListener("click", () => {
      const ws = [1, 2, 3].map(() => window.open("about:blank", "_blank"));
      const ok = ws.filter(Boolean).length;
      state.popupOk = ok === 3;
      $("#popupBadge").textContent = "ポップアップ " + (state.popupOk ? "OK(3/3)" : "NG(" + ok + "/3)");
      $("#popupBadge").className = "badge " + (state.popupOk ? "ok" : "bad");
      if (state.popupOk) { markDone("popup"); log("ポップアップテストOK：3タブ開けた。開いたタブは閉じてOK", "ok"); $("#popupAlert").hidden = true; }
      else { log("ポップアップテストNG：" + ok + "/3 しか開けなかった。アドレスバー右の🚫→常に許可→再テスト", "bad"); showPopupAlert("ポップアップがブロックされてる。アドレスバー右の🚫アイコン→「このサイトのポップアップを常に許可」→もう一回テスト！"); }
      setTimeout(() => ws.forEach((w) => { try { w && w.close(); } catch (e) {} }), 1500);
    });
    // 自動発射テスト：クリックから1.5秒後（ユーザー操作の効力が切れた後）に開けるか
    $("#autoTest").addEventListener("click", () => {
      log("自動発射テスト：1.5秒後にクリックなしで開けるか試す…", "hi");
      setTimeout(() => {
        const w = window.open("about:blank", "_blank");
        state.autoOk = !!w;
        if (w) { log("自動発射テストOK！「解禁と同時に自動発射」が使える💖", "ok"); $("#autoTest").textContent = "🤖 自動発射テスト ✔OK"; setTimeout(() => { try { w.close(); } catch (e) {} }, 1200); }
        else { log("自動発射テストNG：クリックなしだとブロックされる。ポップアップを「常に許可」にすれば通るはず", "bad"); showPopupAlert("自動発射はこのままだと弾かれる。ブラウザ設定でこのサイトのポップアップを「許可」にしてから再テスト。無理なら手動GO（Space連打の準備）で！"); }
      }, 1500);
    });

    // 画面スリープ防止（対応ブラウザのみ）
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible") wake(); });
  }
  async function wake() {
    try { if ("wakeLock" in navigator && !state.wakeLock) state.wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { /* 非対応でも別に困らん */ }
  }

  // ---------- 起動 ----------
  function init() {
    const t = new Date(state.target + 9 * 3600 * 1000);
    $("#targetLabel").textContent = "解禁 " + t.getUTCFullYear() + "/" + pad(t.getUTCMonth() + 1) + "/" + pad(t.getUTCDate()) + " " + fmtJST(state.target) + " JST まで";
    renderCoupons(); bind();
    if (saved.log && saved.log.length) { $("#log").innerHTML = saved.log.join(""); }
    log("作戦室オープン。ターゲット " + C.startJST, "hi");
    syncClock(false).then(() => {
      // 解禁90秒前と5分おきに再同期して精度キープ
      setInterval(() => syncClock(true), 5 * 60 * 1000);
      const before = state.target - 90000 - serverNow();
      if (before > 0) setTimeout(() => syncClock(false), before);
    });
    wake();
    requestAnimationFrame(tick);
  }
  init();
})();
