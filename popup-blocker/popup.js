// =====================================================================
// popup.js ―― アイコン押したら出てくる小窓のロジックだよ🎀
// background.js にメッセージ投げて、設定・登録サイト・ブロック履歴を出し入れする
// =====================================================================
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let info = null;   // getTabInfo の結果を置いとく

const KIND_LABEL = {
  'window.open': { text: 'ポップアップ', cls: '' },
  'fake-click':  { text: '偽クリック',   cls: 'fake' },
  'overlay':     { text: 'オーバーレイ', cls: 'overlay' },
  'adblock-nag': { text: '検出警告',     cls: 'nag' },
};

const hostMatches = (host, site) => host === site || host.endsWith('.' + site);

const render = () => {
  const cfg = info.config;
  $('enabled').checked = cfg.enabled;
  $('enabledLabel').textContent = cfg.enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('off', !cfg.enabled);
  $('blockOverlay').checked = cfg.blockOverlay;
  $('antiAdblock').checked = cfg.antiAdblock !== false;

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

// ---- 操作 ---------------------------------------------------------------
$('enabled').addEventListener('change', async (e) => {
  await send({ type: 'setConfig', patch: { enabled: e.target.checked } });
  refresh();
});
$('blockOverlay').addEventListener('change', async (e) => {
  await send({ type: 'setConfig', patch: { blockOverlay: e.target.checked } });
  refresh();
});
$('antiAdblock').addEventListener('change', async (e) => {
  await send({ type: 'setConfig', patch: { antiAdblock: e.target.checked } });
  refresh();
});

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
  const v = $('siteInput').value;
  const res = await send({ type: 'addSite', host: v, reloadTabId: info.tabId });
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

refresh();
