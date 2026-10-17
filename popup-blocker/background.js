// =====================================================================
// background.js ―― サービスワーカー（裏方）だよ🛠️
//
// ・登録したサイト（sites）にだけ content script を動的に注入する
//   → 登録してないサイトではこの拡張機能は一切動かない
// ・ブロックした件数をタブごとに数えてバッジに出す
// ・ポップアップUI（popup.js）からの問い合わせに答える
// ・ショートカットキー（Alt+Shift+P）でオン・オフ切り替え
// ・オフのときはアイコンをグレーにして分かりやすく
// =====================================================================
const DEFAULTS = { enabled: true, blockOverlay: true, sites: [] };
const MAX_LOG_PER_TAB = 50;   // 1タブで覚えとくブロック履歴の上限
const SCRIPT_IDS = ['pg-main', 'pg-bridge'];

// ---- 設定の読み書き ---------------------------------------------------
const getConfig = async () => {
  const cfg = Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));
  if (!Array.isArray(cfg.sites)) cfg.sites = [];
  return cfg;
};

// ---- ホスト名のお掃除（URL貼られても example.com に直す）-------------------
const normalizeHost = (input) => {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (!/^[a-z]+:\/\//.test(s)) s = 'http://' + s;
    s = new URL(s).hostname;
  } catch (_) { return ''; }
  s = s.replace(/^www\./, '').replace(/\.$/, '');
  // 使える文字だけ（match pattern に突っ込むので変なのは弾く）
  if (!/^[a-z0-9.-]+$/.test(s) || s.startsWith('-') || s.startsWith('.')) return '';
  return s;
};
const hostMatches = (host, sites) => !!host && sites.some((h) => host === h || host.endsWith('.' + h));

// ---- 登録サイト → content script の動的登録 ---------------------------------
// example.com を登録したら *://example.com/* と *://*.example.com/* の両方に注入
const hostToPatterns = (h) => {
  const list = [`*://${h}/*`];
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(h);
  if (!isIp && h !== 'localhost') list.push(`*://*.${h}/*`);
  return list;
};

let syncChain = Promise.resolve();
const syncScripts = () => {
  // 連続で設定が変わっても登録処理が重ならないように直列化
  syncChain = syncChain.then(async () => {
    const cfg = await getConfig();
    const matches = cfg.enabled ? cfg.sites.flatMap(hostToPatterns) : [];
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    if (!matches.length) return;   // 登録サイト無し or OFF → 何も注入しない
    const common = { matches, runAt: 'document_start', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true };
    await chrome.scripting.registerContentScripts([
      Object.assign({ id: 'pg-main', js: ['content-main.js'], world: 'MAIN' }, common),
      Object.assign({ id: 'pg-bridge', js: ['content-bridge.js'], world: 'ISOLATED' }, common),
    ]);
  }).catch((e) => console.warn('[PopupGuard] script sync failed', e));
  return syncChain;
};

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
  await chrome.storage.sync.set({ enabled: cfg.enabled, blockOverlay: cfg.blockOverlay, sites: cfg.sites });
  chrome.action.setBadgeBackgroundColor({ color: '#e0245e' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  applyIcon(cfg.enabled);
  syncScripts();
});
chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  chrome.action.setBadgeBackgroundColor({ color: '#e0245e' });
  applyIcon(cfg.enabled);
  syncScripts();
});

// 設定が変わったらアイコン更新 & 注入先を同期
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.enabled) applyIcon(!!changes.enabled.newValue);
  if (changes.enabled || changes.sites) syncScripts();
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
        try {
          const u = new URL(tab?.url || '');
          if (/^https?:$/.test(u.protocol)) host = u.hostname.toLowerCase();
        } catch (_) {}
        const log = tab ? await getLog(tab.id) : [];
        return sendResponse({
          tabId: tab?.id ?? null,
          host,
          url: tab?.url || '',
          config: cfg,
          siteTargeted: hostMatches(host, cfg.sites),
          log,
        });
      }

      // popup.js: 設定を保存して
      case 'setConfig': {
        const cfg = await getConfig();
        const next = Object.assign({}, cfg, msg.patch || {});
        await chrome.storage.sync.set(next);
        await syncScripts();
        return sendResponse({ ok: true, config: next });
      }

      // popup.js: サイトを登録（URL貼られてもOK）
      case 'addSite': {
        const host = normalizeHost(msg.host);
        if (!host) return sendResponse({ ok: false, error: 'サイト名がちょっと変かも。example.com みたいに入れてね' });
        const cfg = await getConfig();
        if (!cfg.sites.includes(host)) {
          await chrome.storage.sync.set({ sites: [...cfg.sites, host] });
          await syncScripts();
        }
        // 今見てるタブがそのサイトなら、すぐ効くようにリロード
        if (msg.reloadTabId != null) {
          try {
            const tab = await chrome.tabs.get(msg.reloadTabId);
            const h = new URL(tab.url || '').hostname.toLowerCase();
            if (hostMatches(h, [host])) await chrome.tabs.reload(msg.reloadTabId);
          } catch (_) {}
        }
        return sendResponse({ ok: true, host });
      }

      // popup.js: サイトの登録解除
      case 'removeSite': {
        const cfg = await getConfig();
        const host = String(msg.host || '').toLowerCase();
        await chrome.storage.sync.set({ sites: cfg.sites.filter((h) => h !== host) });
        await syncScripts();
        return sendResponse({ ok: true });
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

// SW が起きるたびに一応同期しとく（登録が消えてた場合の保険）
syncScripts();
