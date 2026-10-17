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
  };
  const isActive = () => state.enabled && state.siteTargeted;

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

  const looksLikeAdOverlay = (el) => {
    if (!(el instanceof Element)) return false;
    if (el === document.body || el === document.documentElement) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return false;
    const r = el.getBoundingClientRect();
    const cover = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (cover < vw * vh * 0.8) return false;          // 画面の8割以上覆ってるやつだけ
    const z = parseInt(cs.zIndex, 10);
    if (!(z >= 100)) return false;                      // z-index がそこそこ高いやつだけ

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

  const killOverlay = (el) => {
    if (overlayLog.has(el)) return;
    overlayLog.add(el);
    el.style.setProperty('display', 'none', 'important');
    // スクロールロックも一緒に解除してあげる（body に overflow:hidden 入れてくるやつ対策）
    for (const n of [document.documentElement, document.body]) {
      if (n && getComputedStyle(n).overflow === 'hidden') n.style.setProperty('overflow', 'auto', 'important');
    }
    const link = el.tagName === 'A' ? el.href : (el.querySelector('iframe[src], a[href]') || {}).src
      || (el.querySelector('a[href]') || {}).href || '';
    report('overlay', link, `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>`);
  };

  let scanTimer = null;
  const scanOverlays = () => {
    scanTimer = null;
    if (!isActive() || !state.blockOverlay || !document.body) return;
    // fixed な要素は数が少ないので、全要素なめても一瞬で終わる
    for (const el of document.body.querySelectorAll('body > *, body > * > *, body > * > * > *')) {
      try { if (looksLikeAdOverlay(el)) killOverlay(el); } catch (_) {}
    }
  };
  const scheduleScan = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(scanOverlays, 150);
  };

  const startObserver = () => {
    if (!document.documentElement) return;
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes.length) { scheduleScan(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
    // 遅延ロードで後から出てくる広告用に、しばらく定期チェック
    let n = 0;
    const iv = setInterval(() => { scheduleScan(); if (++n > 20) clearInterval(iv); }, 1500);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  // =====================================================================
  // bridge（content-bridge.js）との連携
  // =====================================================================
  document.addEventListener('popupguard:state', (e) => {
    try {
      const s = JSON.parse(e.detail || '{}');
      if (typeof s.enabled === 'boolean') state.enabled = s.enabled;
      if (typeof s.siteTargeted === 'boolean') state.siteTargeted = s.siteTargeted;
      if (typeof s.blockOverlay === 'boolean') state.blockOverlay = s.blockOverlay;
      scheduleScan();
    } catch (_) {}
  });
  // 「起きたよ〜」って言っておくと bridge が状態を送り直してくれる（順番問題の対策）
  document.dispatchEvent(new CustomEvent('popupguard:ready'));
})();
