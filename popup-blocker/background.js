// =====================================================================
// background.js ―― サービスワーカー（裏方）だよ🛠️
//
// ・ブロックした件数をタブごとに数えてバッジに出す
// ・ポップアップUI（popup.js）からの問い合わせに答える
// ・ショートカットキー（Alt+Shift+P）でオン・オフ切り替え
// ・オフのときはアイコンをグレーにして分かりやすく
// =====================================================================
const DEFAULTS = { enabled: true, blockOverlay: true, allowlist: [] };
const MAX_LOG_PER_TAB = 50;   // 1タブで覚えとくブロック履歴の上限

// ---- 設定の読み書き ---------------------------------------------------
const getConfig = async () => Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));

// ---- タブごとのブロック履歴（storage.session に置けば SW が寝ても消えない）
const logKey = (tabId) => `log:${tabId}`;
const getLog = async (tabId) => (await chrome.storage.session.get(logKey(tabId)))[logKey(tabId)] || [];
const setLog = (tabId, log) => chrome.storage.session.set({ [logKey(tabId)]: log });
const clearLog = (tabId) => chrome.storage.session.remove(logKey(tabId));

// 同時にブロック報告が2つ来ると「読む→足す→書く」が競合して1件消えるので、
// 履歴の書き換えは1本の Promise チェーンに並べて順番に処理する🧵
let logChain = Promise.resolve();
const serialize = (fn) => {
  const run = logChain.then(fn, fn);
  logChain = run.catch(() => {});
  return run;
};

// ---- バッジ & アイコン -------------------------------------------------
const updateBadge = async (tabId) => {
  const log = await getLog(tabId);
  const text = log.length ? String(log.length) : '';
  try {
    await chrome.action.setBadgeText({ tabId, text });
  } catch (_) { /* タブがもう無いとかは気にしない */ }
};

const applyIcon = async (enabled) => {
  const suffix = enabled ? '' : '-off';
  try {
    await chrome.action.setIcon({
      path: {
        16: `icons/icon16${suffix}.png`,
        32: `icons/icon32${suffix}.png`,
        48: `icons/icon48${suffix}.png`,
        128: `icons/icon128${suffix}.png`,
      },
    });
    await chrome.action.setTitle({ title: enabled ? 'ポップアップガード：ON' : 'ポップアップガード：OFF' });
  } catch (_) {}
};

// ---- 初期化 ------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  await chrome.storage.sync.set(cfg);   // デフォ値を書き込んどく
  chrome.action.setBadgeBackgroundColor({ color: '#e0245e' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  applyIcon(cfg.enabled);
});
chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  chrome.action.setBadgeBackgroundColor({ color: '#e0245e' });
  applyIcon(cfg.enabled);
});

// 設定が変わったらアイコン更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) applyIcon(!!changes.enabled.newValue);
});

// ---- content script / popup からのメッセージ -----------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id ?? msg.tabId;

    switch (msg.type) {
      // ページが始まった → そのタブの履歴リセット
      case 'pageStart': {
        if (tabId != null) {
          await serialize(async () => {
            await clearLog(tabId);
            await updateBadge(tabId);
          });
        }
        return sendResponse({ ok: true });
      }

      // ブロックしたよ報告
      case 'blocked': {
        if (tabId == null) return sendResponse({ ok: false });
        await serialize(async () => {
          const log = await getLog(tabId);
          log.unshift({
            kind: msg.kind,
            url: msg.url,
            note: msg.note,
            frameUrl: msg.frameUrl,
            isTop: !!msg.isTop,
            time: Date.now(),
          });
          if (log.length > MAX_LOG_PER_TAB) log.length = MAX_LOG_PER_TAB;
          await setLog(tabId, log);
          await updateBadge(tabId);
        });
        return sendResponse({ ok: true });
      }

      // popup.js: いまのタブの情報ちょうだい
      case 'getTabInfo': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const cfg = await getConfig();
        let host = '';
        try { host = new URL(tab?.url || '').hostname; } catch (_) {}
        const log = tab ? await getLog(tab.id) : [];
        return sendResponse({
          tabId: tab?.id ?? null,
          host,
          url: tab?.url || '',
          config: cfg,
          siteAllowed: !!host && cfg.allowlist.some((h) => host === h || host.endsWith('.' + h)),
          log,
        });
      }

      // popup.js: 設定を保存して
      case 'setConfig': {
        const cfg = await getConfig();
        const next = Object.assign({}, cfg, msg.patch || {});
        await chrome.storage.sync.set(next);
        return sendResponse({ ok: true, config: next });
      }

      // popup.js: このサイトの許可/解除
      case 'toggleSite': {
        const cfg = await getConfig();
        const host = (msg.host || '').toLowerCase();
        if (!host) return sendResponse({ ok: false });
        const list = new Set(cfg.allowlist);
        if (list.has(host)) list.delete(host); else list.add(host);
        await chrome.storage.sync.set({ allowlist: [...list] });
        return sendResponse({ ok: true, siteAllowed: list.has(host) });
      }

      // popup.js: ブロックされたURLを自分の意思で開く
      case 'openUrl': {
        if (!/^https?:/i.test(msg.url || '')) return sendResponse({ ok: false });
        await chrome.tabs.create({ url: msg.url, active: true });
        return sendResponse({ ok: true });
      }

      // popup.js: 履歴消して
      case 'clearLog': {
        if (msg.tabId != null) {
          await clearLog(msg.tabId);
          await updateBadge(msg.tabId);
        }
        return sendResponse({ ok: true });
      }

      default:
        return sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true;   // 非同期で sendResponse するよって合図
});

// ---- タブが閉じたら履歴も捨てる ------------------------------------------
chrome.tabs.onRemoved.addListener((tabId) => { clearLog(tabId); });

// ---- ショートカットキーでオン・オフ --------------------------------------
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-enabled') return;
  const cfg = await getConfig();
  await chrome.storage.sync.set({ enabled: !cfg.enabled });
});
