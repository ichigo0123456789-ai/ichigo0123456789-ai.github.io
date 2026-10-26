// =====================================================================
// popup.js ―― アイコン押したら出てくる小窓のロジックだよ🎀
// background.js にメッセージ投げて、設定・登録サイト・ブロック履歴を出し入れする
// =====================================================================
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let info = null;   // getTabInfo の結果を置いとく

// ブロック履歴の種類 → 表示ラベル
const KIND_LABEL = {
  'window.open':  { text: 'ポップアップ', cls: '' },
  'fake-click':   { text: '偽クリック',   cls: 'fake' },
  'overlay':      { text: 'オーバーレイ', cls: 'overlay' },
  'adblock-nag':  { text: '検出警告',     cls: 'nag' },
  'keep-visible': { text: '裏タブ',       cls: 'vis' },
  'wasd':         { text: 'WASD',         cls: 'wasd' },
};

const hostMatches = (host, site) => host === site || host.endsWith('.' + site);

// ---- 画面を描く ----------------------------------------------------------
const render = () => {
  const cfg = info.config;
  $('enabled').checked = cfg.enabled;
  $('enabledLabel').textContent = cfg.enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('off', !cfg.enabled);
  $('blockOverlay').checked = cfg.blockOverlay;
  $('antiAdblock').checked = cfg.antiAdblock !== false;
  $('keepVisible').checked = cfg.keepVisible !== false;
  $('wasdKeys').checked = cfg.wasdKeys !== false;

  // 今見てるサイト（chrome:// とかホスト無いページは無効化）
  $('siteTargeted').checked = info.siteTargeted;
  $('siteTargeted').disabled = !info.host;
  $('hostLabel').textContent = info.host || 'このページでは設定できないよ';

  // 登録サイト一覧
  const sites = cfg.sites || [];
  $('siteCount').textContent = sites.length;
  const sl = $('sites');
  sl.innerHTML = '';
  for (const site of sites) {
    const li = document.createElement('li');
    const isCurrent = !!info.host && hostMatches(info.host, site);
    if (isCurrent) li.classList.add('current');
    const h = document.createElement('span');
    h.className = 'host';
    h.textContent = site;
    li.append(h);
    if (isCurrent) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '今ここ';
      li.append(tag);
    }
    const rm = document.createElement('button');
    rm.className = 'remove-btn';
    rm.title = '登録解除';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'removeSite', host: site });
      refresh();
    });
    li.append(rm);
    sl.append(li);
  }
  sl.classList.toggle('hidden', sites.length === 0);
  $('sitesEmpty').classList.toggle('hidden', sites.length !== 0);

  // ブロック履歴
  const log = info.log || [];
  $('count').textContent = log.length;
  const ul = $('log');
  ul.innerHTML = '';
  for (const item of log) {
    const li = document.createElement('li');
    const k = KIND_LABEL[item.kind] || { text: item.kind, cls: '' };
    const kind = document.createElement('span');
    kind.className = 'kind ' + k.cls;
    kind.textContent = k.text;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = item.url || item.note || '(URLなし)';
    url.title = [item.url, item.note].filter(Boolean).join('\n');
    li.append(kind, url);
    // http(s) のURLだけ「開く」ボタンを付ける（自分の意思で開けるように）
    if (/^https?:/i.test(item.url || '')) {
      const btn = document.createElement('button');
      btn.className = 'open-btn';
      btn.textContent = '開く';
      btn.addEventListener('click', () => send({ type: 'openUrl', url: item.url }));
      li.append(btn);
    }
    ul.append(li);
  }
  ul.classList.toggle('hidden', log.length === 0);
  $('empty').classList.toggle('hidden', log.length !== 0);

  $('status').textContent = !cfg.enabled
    ? 'ガードはOFF中。どのサイトでもブロックしないよ'
    : !info.host
      ? '登録したサイトだけでブロックするよ'
      : info.siteTargeted
        ? 'このサイトはガード中✨ ブロックした分は上に出るよ'
        : 'このサイトは対象外。スイッチをONにするとブロック開始（ページは再読み込みされるよ）';
};

const refresh = async () => {
  info = await send({ type: 'getTabInfo' });
  render();
};

const showError = (msg) => {
  $('addError').textContent = msg || '';
  $('addError').classList.toggle('hidden', !msg);
};

// ---- 設定スイッチ ----------------------------------------------------------
const bindToggle = (id, key) => {
  $(id).addEventListener('change', async (e) => {
    await send({ type: 'setConfig', patch: { [key]: e.target.checked } });
    refresh();
  });
};
bindToggle('enabled', 'enabled');
bindToggle('blockOverlay', 'blockOverlay');
bindToggle('antiAdblock', 'antiAdblock');
bindToggle('keepVisible', 'keepVisible');
bindToggle('wasdKeys', 'wasdKeys');

// 今見てるサイトのON/OFF（ONにしたらリロードして即効かせる）
$('siteTargeted').addEventListener('change', async (e) => {
  if (!info.host) return;
  if (e.target.checked) {
    await send({ type: 'addSite', host: info.host, reloadTabId: info.tabId });
  } else {
    // このホストにマッチしてる登録を全部外す（親ドメイン登録も含む）
    for (const site of info.config.sites) {
      if (hostMatches(info.host, site)) await send({ type: 'removeSite', host: site });
    }
  }
  refresh();
});

// 入力欄から追加
$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await send({ type: 'addSite', host: $('siteInput').value, reloadTabId: info.tabId });
  if (!res.ok) { showError(res.error); return; }
  showError('');
  $('siteInput').value = '';
  refresh();
});

$('clear').addEventListener('click', async () => {
  await send({ type: 'clearLog', tabId: info.tabId });
  refresh();
});

// 開いてる間にブロックが増えたら履歴を更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' || area === 'sync') refresh();
});

// ---- 診断情報：background → bridge → MAIN world と聞きに行って、JSON で出す 🩺 ----
$('diagBtn').addEventListener('click', async () => {
  $('diagBox').classList.remove('hidden');
  $('diagText').value = '集めてる…';
  let res;
  try { res = await send({ type: 'diag' }); } catch (e) { res = { error: String(e) }; }
  $('diagText').value = JSON.stringify(res, null, 1);
});
$('diagCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('diagText').value); }
  catch (_) { $('diagText').select(); document.execCommand('copy'); }
  $('diagCopy').textContent = 'コピーした✨';
  setTimeout(() => { $('diagCopy').textContent = 'コピー'; }, 1500);
});

// ---- 新バージョンチェック（GitHub 上の manifest.json と比べる。6時間に1回だけ取りに行く）----
const UPDATE_URLS = [
  'https://raw.githubusercontent.com/ichigo0123456789-ai/ichigo0123456789-ai.github.io/claude/confident-bohr-x8hd9x/popup-blocker/manifest.json',
  'https://ichigo0123456789-ai.github.io/popup-blocker/manifest.json',
];
const cmpVer = (a, b) => {   // a > b なら 1、a < b なら -1
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
};
const checkUpdate = async () => {
  const mine = chrome.runtime.getManifest().version;
  let latest = null;
  try {
    const cache = (await chrome.storage.local.get('updateCheck')).updateCheck;
    if (cache && Date.now() - cache.at < 6 * 3600 * 1000) latest = cache.latest;
  } catch (_) {}
  if (!latest) {
    for (const u of UPDATE_URLS) {
      try {
        const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) continue;
        const v = (await r.json()).version;
        if (v) { latest = v; break; }   // 1つ取れたらそれで十分（残りは試さない＝404ノイズを出さない）
      } catch (_) {}
    }
    try { await chrome.storage.local.set({ updateCheck: { at: Date.now(), latest } }); } catch (_) {}
  }
  if (latest && cmpVer(latest, mine) > 0) {
    $('updateText').textContent = `新しい v${latest} があるよ（今は v${mine}）`;
    $('updateBanner').classList.remove('hidden');
  }
};
checkUpdate();

// バージョン表示（最新版が入ってるか確認用）
try { $('version').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) {}
refresh();
