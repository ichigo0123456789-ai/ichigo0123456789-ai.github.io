// =====================================================================
// popup.js ―― アイコン押したら出てくる小窓のロジックだよ🎀
// background.js にメッセージ投げて、設定とブロック履歴を出し入れする
// =====================================================================
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let info = null;   // getTabInfo の結果を置いとく

const KIND_LABEL = {
  'window.open': { text: 'ポップアップ', cls: '' },
  'fake-click':  { text: '偽クリック',   cls: 'fake' },
  'overlay':     { text: 'オーバーレイ', cls: 'overlay' },
};

const render = () => {
  const cfg = info.config;
  $('enabled').checked = cfg.enabled;
  $('enabledLabel').textContent = cfg.enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('off', !cfg.enabled);
  $('blockOverlay').checked = cfg.blockOverlay;

  // このサイトの表示（chrome:// とかホスト無いページは無効化）
  $('siteAllowed').checked = info.siteAllowed;
  $('siteAllowed').disabled = !info.host;
  $('hostLabel').textContent = info.host || 'このページでは設定できないよ';

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
    ? 'ガードはOFF中。全サイトでそのまま表示されるよ'
    : info.siteAllowed
      ? 'このサイトは許可リスト入り。ブロックしてないよ'
      : 'ガード中✨ ブロックした分は上に出るよ';
};

const refresh = async () => {
  info = await send({ type: 'getTabInfo' });
  render();
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
$('siteAllowed').addEventListener('change', async () => {
  await send({ type: 'toggleSite', host: info.host });
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
