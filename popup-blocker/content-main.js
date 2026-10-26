// =====================================================================
// content-main.js  ―― ページ本体（MAIN world）で動くガード本体だよ💅
//
// ここはサイトのJSと同じ世界で動くから、window.open とかを
// 直接すり替えてポップアップを止められるってワケ。
// chrome.* のAPIは使えないから、設定とかは content-bridge.js と
// CustomEvent でやり取りするよ（detail は JSON 文字列で渡す）。
// =====================================================================
(() => {
  'use strict';

  // 二重で仕込まれたらウケるので、1回だけにする
  if (window.__popupGuardInstalled) return;
  window.__popupGuardInstalled = true;

  // ---- いまの状態（bridge から届くまでのデフォ）---------------------
  // このスクリプトは登録サイトにしか注入されないので、デフォは「ガードする」
  const state = {
    enabled: true,        // ガード自体がオンか
    siteTargeted: true,   // このサイトが登録サイトか
    blockOverlay: true,   // 全画面オーバーレイも消すか
    antiAdblock: true,    // 「広告ブロッカーを検出しました」系の警告を潰すか
    keepVisible: true,    // 別タブに移っても画面をぼかさせない（タブ非表示をサイトに気づかせない）
  };
  const isActive = () => state.enabled && state.siteTargeted;

  // 診断用：うちの処理で起きたエラーと、消した要素の数を覚えとく
  const pgErrors = [];
  const noteError = (where, e) => { try { pgErrors.push(where + ': ' + (e && e.message || e)); } catch (_) {} };
  let killedCount = 0;

  // ---- ブロックしたよ〜って bridge に報告する -------------------------
  const report = (kind, url, note) => {
    try {
      document.dispatchEvent(new CustomEvent('popupguard:blocked', {
        detail: JSON.stringify({ kind, url: String(url || ''), note: note || '' }),
      }));
    } catch (_) { /* まぁ落ちても気にしない */ }
  };

  // ---- 「ユーザーが今ほんとにクリックしたか」のざっくり判定 ------------
  // 直近の trusted なクリックから 1 秒以内なら、本人の操作って扱う。
  // ただし、ポップアンダーは本人のクリックに便乗して開くから
  // これだけじゃ防げない → window.open は基本ぜんぶ止める方針✌️
  let lastTrustedClick = 0;
  window.addEventListener('mousedown', (e) => {
    if (e.isTrusted) lastTrustedClick = Date.now();
  }, true);

  // =====================================================================
  // ⓪ 「広告ブロッカー検出」を回避する
  //    アンチアドブロック系スクリプトの多くは window.adsbygoogle.loaded === true を
  //    「AdSense がちゃんと動いてる」証拠として見て検出をやめる。
  //    なので先回りして loaded=true の配列を置いとく（push は本物の Array.prototype.push
  //    = native code なので「ダミーだ」とバレにくい）。
  //    サイト側が window.adsbygoogle = [] で上書きしても setter で loaded を付け直す💪
  //    ※ 登録サイトでは本物の AdSense が初期化をスキップして広告が出なくなることがある
  // =====================================================================
  let adsArray = [];
  const nativePush = Array.prototype.push;
  const fnSrc = (f) => { try { return Function.prototype.toString.call(f); } catch (_) { return ''; } };
  // 広告ブロッカーのダミー（push が空っぽ／this.length をいじるだけ）かどうか
  const looksLikeStubPush = (f) => {
    if (typeof f !== 'function') return true;
    const src = fnSrc(f);
    if (src.includes('[native code]')) return false;
    const body = src.replace(/\s+/g, '');
    return /\{(;|return;?)?\}$/.test(body) || body.includes('this.length');
  };
  const applyAdsSpoof = (arr) => {
    try {
      if (arr && typeof arr === 'object' && state.antiAdblock && isActive()) {
        if (arr.loaded !== true) { arr.loaded = true; arr.__pgSpoofed = true; }
        // ダミー push に差し替えられてたら本物（native）に戻す
        if (looksLikeStubPush(arr.push)) {
          try { Object.defineProperty(arr, 'push', { value: nativePush, writable: true, configurable: true }); } catch (_) {}
        }
      } else if (arr && arr.__pgSpoofed) {
        delete arr.loaded; delete arr.__pgSpoofed;
      }
    } catch (_) {}
  };
  try {
    const existing = window.adsbygoogle;
    if (Array.isArray(existing)) adsArray = existing;
    Object.defineProperty(window, 'adsbygoogle', {
      configurable: true, enumerable: true,
      get() { applyAdsSpoof(adsArray); return adsArray; },
      set(v) {
        // 広告ブロッカーのダミー（{loaded:true, push(){}} みたいな非配列）は受け取らない。
        // サイト側の window.adsbygoogle = [] みたいな普通の配列はそのまま採用する
        if (state.antiAdblock && isActive() && (!Array.isArray(v) || looksLikeStubPush(v.push))) {
          report('adblock-nag', '', 'adsbygoogle のダミー差し替えを拒否');
          return;
        }
        adsArray = v;
        applyAdsSpoof(adsArray);
      },
    });
    applyAdsSpoof(adsArray);
  } catch (e) { noteError('adsbygoogle defineProperty', e); report('adblock-nag', '', 'adsbygoogle の偽装に失敗: ' + (e && e.message)); }

  // 広告ブロッカーのダミーが作る偽の広告 iframe（id="aswift_N" で中身が data:/javascript:/空）を
  // アンチアドブロックに見つかる前に消す。MutationObserver は同じタスク内のマイクロタスクで
  // 走るので、サイトの検出タイマーより先に片付く⚡
  const isFakeAdFrame = (n) => {
    if (!(n instanceof HTMLIFrameElement) || !/^aswift_/.test(n.id || '')) return false;
    const src = n.getAttribute('src') || '';
    return !/^https?:/i.test(src);
  };
  const removeFakeAdFrames = (root) => {
    if (!state.antiAdblock || !isActive()) return;
    try {
      if (isFakeAdFrame(root)) { root.remove(); return; }
      if (root.querySelectorAll) for (const f of root.querySelectorAll('iframe[id^="aswift_"]')) if (isFakeAdFrame(f)) f.remove();
    } catch (_) {}
  };

  // =====================================================================
  // ⓪' 別タブに移っても画面を隠させない
  //    「タブが非表示になった／ウィンドウのフォーカスが外れた」を検知して本文を
  //    blur(20px) したりオーバーレイを被せるサイト対策。
  //    ・document.hidden → 常に false、visibilityState → 常に 'visible'、hasFocus() → 常に true
  //    ・window/document に飛んでくる blur / visibilitychange を、サイトのリスナーより先に
  //      capture で捕まえて stopImmediatePropagation（うちは document_start で最初に登録してるので勝てる）
  //    保険として、本当にタブが裏にいる間だけ、でかい要素の inline blur を剥がす🧹
  // =====================================================================
  const realHasFocus = Document.prototype.hasFocus;
  const realVisDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const realHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const reallyHidden = () => {
    try { return (realHiddenDesc && realHiddenDesc.get.call(document)) || !realHasFocus.call(document); } catch (_) { return false; }
  };
  const keepVisibleOn = () => isActive() && state.keepVisible;
  let visSpoofed = false;
  const applyVisibilitySpoof = () => {
    const want = keepVisibleOn();
    if (want === visSpoofed) return;
    visSpoofed = want;
    try {
      if (want) {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hasFocus', { configurable: true, writable: true, value: () => true });
      } else {
        delete document.hidden; delete document.visibilityState; delete document.hasFocus;
      }
    } catch (e) { noteError('visibility spoof', e); }
  };
  applyVisibilitySpoof();
  const swallow = (e) => {
    if (!keepVisibleOn()) return;
    // window 自身の blur / document の visibilitychange だけ止める（input の blur とかは通す）
    if (e.target !== window && e.target !== document) return;
    e.stopImmediatePropagation();
    report('keep-visible', '', `${e.type} をサイトに渡さなかった`);
  };
  for (const type of ['blur', 'visibilitychange', 'webkitvisibilitychange', 'pagehide']) {
    window.addEventListener(type, swallow, true);
    document.addEventListener(type, swallow, true);
  }
  // 保険：本当に裏にいる間に、画面の半分以上を占める要素へ inline で blur が掛かってたら剥がす
  const unblurIfHidden = () => {
    if (!keepVisibleOn() || !reallyHidden() || !document.body) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of document.querySelectorAll('[style*="blur("]')) {
      try {
        if (!/blur\(/.test(el.style.filter + ' ' + el.style.backdropFilter)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < vw * vh * 0.5) continue;
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('backdrop-filter', 'none', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
        report('keep-visible', '', 'inline blur を解除');
      } catch (_) {}
    }
  };

  // =====================================================================
  // ① window.open をすり替える（ポップアップ／ポップアンダーの本丸）
  // =====================================================================
  const realOpen = window.open;

  // ブロックしたときに返すダミー window。
  // 広告スクリプトが w.focus() とか w.document.write() しても落ちないように
  // それっぽいメソッドを全部ノーオペにしてある😇
  const makeDummyWindow = () => {
    const noop = () => {};
    const dummy = {
      closed: true,
      focus: noop, blur: noop, close: noop, postMessage: noop,
      moveTo: noop, moveBy: noop, resizeTo: noop, resizeBy: noop,
      alert: noop, print: noop, stop: noop,
      addEventListener: noop, removeEventListener: noop,
      location: { href: '', assign: noop, replace: noop, reload: noop, toString: () => '' },
      document: { write: noop, writeln: noop, close: noop, open: noop, body: null, title: '' },
      opener: null, parent: null, top: null, self: null, window: null,
    };
    dummy.self = dummy.window = dummy;
    return dummy;
  };

  const guardedOpen = function (url, target, features) {
    if (!isActive()) {
      return realOpen.apply(this, arguments);
    }
    // 自分自身（_self / _parent / _top）への遷移は普通のリンクと同じだから通す
    const t = (target || '').toString().toLowerCase();
    if (t === '_self' || t === '_parent' || t === '_top') {
      return realOpen.apply(this, arguments);
    }
    report('window.open', url, features ? `features: ${features}` : '');
    return makeDummyWindow();
  };

  // サイト側が window.open = ... で上書きし直せないように固定しとく
  try {
    Object.defineProperty(window, 'open', {
      value: guardedOpen, writable: false, configurable: false, enumerable: true,
    });
  } catch (_) {
    window.open = guardedOpen;
  }

  // =====================================================================
  // ② 偽クリック（スクリプトが勝手に発火させた click）で開く新規タブを止める
  //    例: a.target="_blank" な要素を作って a.click() → 広告タブ
  //    isTrusted が false のクリックは人間の操作じゃないので弾く🙅‍♀️
  // =====================================================================
  const findAnchor = (node) => {
    while (node && node !== document) {
      if (node.tagName === 'A' || node.tagName === 'AREA' || node.tagName === 'FORM') return node;
      node = node.parentNode;
    }
    return null;
  };

  window.addEventListener('click', (e) => {
    if (!isActive() || e.isTrusted) return;
    const a = findAnchor(e.target);
    if (!a) return;
    const target = (a.getAttribute('target') || '').toLowerCase();
    const href = a.href || a.action || '';
    // 新規タブ/ウィンドウに飛ばそうとしてる偽クリックだけ止める
    if (target === '_blank' || (target && target !== '_self' && target !== '_parent' && target !== '_top')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      report('fake-click', href, '偽クリックで新規タブを開こうとした');
    }
  }, true);

  // HTMLElement.prototype.click も偽クリック経路なのでフック
  // （dispatchEvent 経由と同じく isTrusted=false になるけど、念のため先に弾く）
  try {
    const realClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      if (isActive()) {
        const a = findAnchor(this);
        if (a) {
          const target = (a.getAttribute('target') || '').toLowerCase();
          if (target === '_blank') {
            report('fake-click', a.href || '', 'element.click() で新規タブ');
            return;
          }
        }
      }
      return realClick.apply(this, arguments);
    };
  } catch (_) { /* 無理なら諦める */ }

  // =====================================================================
  // ③ 全画面オーバーレイ広告を消す（任意・デフォON）
  //    position:fixed で画面のほぼ全部を覆ってて、中身が広告っぽい
  //    （別ドメインの iframe / 別ドメインへの巨大リンク / テキストほぼ無し）
  //    ものだけ消す。ログインモーダルとかは残るように、かなり控えめにしてる。
  // =====================================================================
  const overlayLog = new WeakSet();

  const isCrossOrigin = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.origin !== location.origin && /^https?:$/.test(u.protocol);
    } catch (_) { return false; }
  };

  // 「広告ブロッカーを検出しました」「AdBlockを無効にしてください」系の文言
  const NAG_RE = /広告ブロッ[クカ]|広告を?ブロック|ad[\s-]?block|adblocker|ublock|brave.{0,12}shields|shields.{0,12}(有効|オフ|off|無効)|disable your ad|allow ads|ad[\s-]?guard|広告(を|の)(表示|有効)|広告収益によって/i;

  const looksLikeAdblockNag = (el, cs, cover, vw, vh) => {
    if (!state.antiAdblock) return false;
    if (cover < vw * vh * 0.6) return false;             // 警告系は背景ごと画面を覆ってくる
    if (el.querySelector('input, textarea, select')) return false;
    const text = (el.innerText || el.textContent || '').slice(0, 2000);
    if (!NAG_RE.test(text)) return false;
    // 本文全体がたまたま一致しないように、文字数が多すぎる要素（記事本文とか）は除外
    return text.replace(/\s+/g, '').length < 800;
  };

  const looksLikeAdOverlay = (el) => {
    if (!(el instanceof Element)) return false;
    if (el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return false;
    const r = el.getBoundingClientRect();
    const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const z = parseInt(cs.zIndex, 10);
    if (!(z >= 100)) return false;                      // z-index がそこそこ高いやつだけ

    // 「広告ブロッカー検出」の警告モーダル → 消す
    if (looksLikeAdblockNag(el, cs, cover, vw, vh)) return 'nag';

    if (!state.blockOverlay) return false;
    if (cover < vw * vh * 0.8) return false;          // 画面の8割以上覆ってるやつだけ

    // 入力欄があるやつ（ログイン・検索・同意フォーム）はたぶん本物なので触らない
    if (el.querySelector('input, textarea, select, button[type="submit"]')) return false;

    // 別ドメインの iframe を抱えてたら広告判定
    for (const f of el.querySelectorAll('iframe')) {
      if (f.src && isCrossOrigin(f.src)) return true;
    }
    // 要素自体 or 子孫に、別ドメインへ飛ぶ巨大リンクがあったら広告判定
    const anchors = el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a[href]'));
    for (const a of anchors) {
      if (!isCrossOrigin(a.href)) continue;
      const ar = a.getBoundingClientRect();
      if (ar.width * ar.height >= vw * vh * 0.5) return true;
    }
    // 文字がほぼ無い透明クリック罠（click 捕まえて window.open する用）も広告判定
    const text = (el.textContent || '').trim();
    if (text.length < 5 && cs.pointerEvents !== 'none' && !el.querySelector('img, video, canvas, svg')) {
      const bg = cs.backgroundColor;
      const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || parseFloat(cs.opacity) < 0.05;
      if (transparent) return true;
    }
    return false;
  };

  // 警告モーダルを出すサイトは本文側に pointer-events:none を掛けてクリックを殺してくるので、
  // 画面の半分以上を占める要素でそうなってるやつは元に戻す
  const restorePointerEvents = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of document.querySelectorAll('[style*="pointer-events"]')) {
      try {
        if (el.style.pointerEvents !== 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < vw * vh * 0.5) continue;
        el.style.setProperty('pointer-events', 'auto', 'important');
        el.style.setProperty('user-select', 'auto', 'important');
        if (el.getAttribute('aria-hidden') === 'true') el.removeAttribute('aria-hidden');
      } catch (_) {}
    }
  };

  const killOverlay = (el, kind) => {
    if (overlayLog.has(el)) return;
    overlayLog.add(el);
    killedCount += 1;
    el.style.setProperty('display', 'none', 'important');
    // スクロールロックも一緒に解除してあげる（body に overflow:hidden 入れてくるやつ対策）
    for (const n of [document.documentElement, document.body]) {
      if (n && getComputedStyle(n).overflow === 'hidden') n.style.setProperty('overflow', 'auto', 'important');
    }
    if (kind === 'nag') restorePointerEvents();
    const link = el.tagName === 'A' ? el.href : (el.querySelector('iframe[src], a[href]') || {}).src
      || (el.querySelector('a[href]') || {}).href || '';
    const desc = `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>`;
    report(kind === 'nag' ? 'adblock-nag' : 'overlay', link, desc);
  };

  let scanTimer = null;
  const scanOverlays = () => {
    scanTimer = null;
    if (!isActive() || !(state.blockOverlay || state.antiAdblock || state.keepVisible) || !document.body) return;
    // fixed な要素は数が少ないので、全要素なめても一瞬で終わる
    for (const el of document.body.querySelectorAll('body > *, body > * > *, body > * > * > *')) {
      try {
        const kind = looksLikeAdOverlay(el);
        if (kind) killOverlay(el, kind);
      } catch (e) { noteError('scan', e); }
    }
    if (state.antiAdblock) { restorePointerEvents(); removeFakeAdFrames(document.body); }
    unblurIfHidden();
  };
  const scheduleScan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(scanOverlays, 150);
  };

  const startObserver = () => {
    if (!document.documentElement) return;
    // 要素の追加だけじゃなく、display/class の切り替えで出てくるやつも拾う
    new MutationObserver((muts) => {
      let dirty = false;
      for (const m of muts) {
        if (m.type === 'attributes') dirty = true;
        for (const n of m.addedNodes) { dirty = true; if (n.nodeType === 1) removeFakeAdFrames(n); }
      }
      if (dirty) scheduleScan();
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'],
    });
    scheduleScan();
    // 遅延ロードや「数秒後に検出→警告」パターン用に、ずっと軽く定期チェック（2秒ごと）
    setInterval(scheduleScan, 2000);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // =====================================================================
  // 診断：小窓の「診断情報を表示」から呼ばれる。ページ内の状態をまとめて返す🩺
  // =====================================================================
  const describeEl = (el) => `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>`;
  const collectDiag = () => {
    const d = { installed: true, active: isActive(), state: Object.assign({}, state), brave: !!(navigator.brave), errors: pgErrors.slice(-10), killed: killedCount };
    try {
      const desc = Object.getOwnPropertyDescriptor(window, 'adsbygoogle');
      const a = window.adsbygoogle;
      d.adsbygoogle = {
        descriptor: desc ? (desc.get ? 'getter' : typeof desc.value) + (desc.configurable ? ' (configurable)' : ' (NOT configurable)') : 'none',
        isArray: Array.isArray(a), loaded: a && a.loaded, spoofed: !!(a && a.__pgSpoofed),
        push: a && a.push ? String(a.push).replace(/\s+/g, ' ').slice(0, 60) : String(a && a.push),
      };
    } catch (e) { d.adsbygoogle = 'error: ' + e.message; }
    try { d.visibility = { hidden: document.hidden, visibilityState: document.visibilityState, hasFocus: document.hasFocus() }; } catch (e) { d.visibility = 'error: ' + e.message; }
    try {
      const vw = window.innerWidth, vh = window.innerHeight;
      d.bigFixed = [];
      for (const el of document.body.querySelectorAll('body > *, body > * > *, body > * > * > *')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / (vw * vh);
        if (cover < 0.5) continue;
        let verdict = null; try { verdict = looksLikeAdOverlay(el); } catch (e) { verdict = 'error: ' + e.message; }
        d.bigFixed.push({ el: describeEl(el), display: cs.display, zIndex: cs.zIndex, cover: Math.round(cover * 100) + '%', verdict, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 60) });
      }
      d.adguard = Array.from(document.querySelectorAll('.adguard-overlay')).map((el) => describeEl(el) + ' display=' + getComputedStyle(el).display + ' parent=' + (el.parentElement ? el.parentElement.tagName : '?'));
    } catch (e) { d.bigFixed = 'error: ' + e.message; }
    return d;
  };
  document.addEventListener('popupguard:diag-request', () => {
    let payload;
    try { payload = JSON.stringify(collectDiag()); } catch (e) { payload = JSON.stringify({ installed: true, error: String(e) }); }
    document.dispatchEvent(new CustomEvent('popupguard:diag', { detail: payload }));
  });

  // =====================================================================
  // bridge（content-bridge.js）との連携
  // =====================================================================
  document.addEventListener('popupguard:state', (e) => {
    try {
      const s = JSON.parse(e.detail || '{}');
      if (typeof s.enabled === 'boolean') state.enabled = s.enabled;
      if (typeof s.siteTargeted === 'boolean') state.siteTargeted = s.siteTargeted;
      if (typeof s.blockOverlay === 'boolean') state.blockOverlay = s.blockOverlay;
      if (typeof s.antiAdblock === 'boolean') state.antiAdblock = s.antiAdblock;
      if (typeof s.keepVisible === 'boolean') state.keepVisible = s.keepVisible;
      applyAdsSpoof(adsArray);
      applyVisibilitySpoof();
      scheduleScan();
    } catch (_) {}
  });
  // 「起きたよ〜」って言っておくと bridge が状態を送り直してくれる（順番問題の対策）
  document.dispatchEvent(new CustomEvent('popupguard:ready'));
})();
