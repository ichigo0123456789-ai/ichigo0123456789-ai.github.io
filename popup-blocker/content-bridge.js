// =====================================================================
// content-bridge.js ―― 拡張機能側（ISOLATED world）の橋渡し係だよ🌉
//
// ・chrome.storage から設定を読んで、MAIN world の content-main.js に
//   CustomEvent で渡す（登録サイトにしか注入されないよ）
// ・content-main.js が「ブロックしたよ」って言ってきたら
//   background.js に転送してバッジのカウントを増やしてもらう
// =====================================================================
(() => {
  'use strict';

  const DEFAULTS = { enabled: true, blockOverlay: true, antiAdblock: true, keepVisible: true, sites: [] };
  const host = (location.hostname || '').toLowerCase();

  // 登録サイト判定（サブドメインも含めてマッチ。example.com を登録したら a.example.com も対象）
  // このスクリプト自体が登録サイトにしか注入されないけど、二重チェックしとく
  const isTargetHost = (sites) => {
    if (!host) return false;
    return (sites || []).some((h) => host === h || host.endsWith('.' + h));
  };

  const sendState = async () => {
    let cfg = DEFAULTS;
    try {
      cfg = Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));
    } catch (_) { /* storage 読めなかったらデフォで */ }
    const payload = {
      enabled: !!cfg.enabled,
      siteTargeted: isTargetHost(cfg.sites),
      blockOverlay: !!cfg.blockOverlay,
      antiAdblock: !!cfg.antiAdblock,
      keepVisible: !!cfg.keepVisible,
    };
    document.dispatchEvent(new CustomEvent('popupguard:state', { detail: JSON.stringify(payload) }));
  };

  // MAIN 側が起きたら状態を送る。自分が先に起きてた場合もこれで追いつける
  document.addEventListener('popupguard:ready', () => { sendState(); });
  sendState();

  // 設定が変わったら（ポップアップUIで切り替えたとき）即反映
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') sendState();
    });
  } catch (_) {}

  // ブロック報告を background に転送
  document.addEventListener('popupguard:blocked', (e) => {
    let info = {};
    try { info = JSON.parse(e.detail || '{}'); } catch (_) {}
    try {
      chrome.runtime.sendMessage({
        type: 'blocked',
        kind: info.kind || 'unknown',
        url: info.url || '',
        note: info.note || '',
        frameUrl: location.href,
        isTop: window === window.top,
      });
    } catch (_) { /* SW が寝てて失敗しても気にしない */ }
  });

  // 小窓からの診断リクエスト：MAIN 側に聞いて、返事をそのまま返す
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'diag' || window !== window.top) return;
      let done = false;
      const finish = (data) => { if (done) return; done = true; sendResponse(data); };
      const onDiag = (e) => {
        document.removeEventListener('popupguard:diag', onDiag);
        let main = null; try { main = JSON.parse(e.detail || 'null'); } catch (_) {}
        finish({ bridge: true, version: chrome.runtime.getManifest().version, host, url: location.href, main });
      };
      document.addEventListener('popupguard:diag', onDiag);
      document.dispatchEvent(new CustomEvent('popupguard:diag-request'));
      setTimeout(() => { document.removeEventListener('popupguard:diag', onDiag); finish({ bridge: true, version: chrome.runtime.getManifest().version, host, url: location.href, main: null, note: 'MAIN world から返事なし（content-main.js が動いてない）' }); }, 800);
      return true;
    });
  } catch (_) {}

  // トップフレームでページが始まったら、そのタブのカウントをリセット
  if (window === window.top) {
    try { chrome.runtime.sendMessage({ type: 'pageStart', url: location.href }); } catch (_) {}
  }
})();
