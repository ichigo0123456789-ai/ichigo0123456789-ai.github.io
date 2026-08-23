#!/usr/bin/env node
/* ============================================================
   KINEZO 予約（ハイブリッド版 = 最速）
   ------------------------------------------------------------
   「掴む」を純HTTPで直POST（サブ秒）し、その確保済みセッションの Cookie を
   実ブラウザに注入して、そのまま決済画面を人間が続ける。
     - 確保: reserve.js と同じ経路（login → openShow → choiceSeatSave）を
             ブラウザ無しで実行 ＝ スクリプト読み込みが無く最速。
     - 決済: 同じ Cookie をブラウザに渡す ＝ 同一セッションなので
             「別ブラウザに引き継げない」問題が起きない。

   前提: 手元PCに Playwright（決済ウィンドウ用）
     cd runner && npm install && npx playwright install chromium
   認証情報は config.js が手元(env / runner/.env)からのみ読む。

   使い方:
     node runner/reserve-hybrid.js --login-only
     node runner/reserve-hybrid.js --date 2026-08-21 --title オークストリート --time 15:00 --seats A-3 --dry
     node runner/reserve-hybrid.js --date 2026-08-21 --title オークストリート --time 15:00 --seats A-3
     node runner/reserve-hybrid.js --date 2026-08-27 --title ユーフォニアム --time 10:00 --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"

   --seats は「優先グループ」を '/' で区切って第2候補以降も指定できる（各グループはカンマ区切りの席）:
     --seats "G-10,G-11 / F-10,F-11 / H-8,H-9"
     → 第1候補 G-10,G-11 が埋まっていれば F-10,F-11 → H-8,H-9 の順で自動確保。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const { Kinezo } = require('./lib/kinezo');
const { K109 } = require('./lib/k109');
const { Toho } = require('./lib/toho');
const { Cinecitta } = require('./lib/cinecitta');
const { Sunshine } = require('./lib/sunshine');
const { loadCreds } = require('./config');
const { request } = require('./lib/http');

var BASE = 'https://tjoy.jp';

/* KINEZO 系の対応劇場。--theater <key> で切替（既定 yokohama）。
   同じ KINEZO なので劇場パスと theaterId が違うだけで、ログイン/座席/確保は共通。 */
var THEATERS = {
  yokohama: { path: 't-joy_yokohama', id: '190', name: 'T・ジョイ横浜' },
  wald9:    { path: 'shinjuku_wald9', id: '140', name: '新宿バルト9' },
  kyoto: { path: 't-joy_kyoto', id: '360', name: 'T・ジョイ京都' },
  umeda: { path: 't-joy_umeda', id: '320', name: 'T・ジョイ梅田' },
  burg13: { path: 'yokohama_burg13', id: '170', name: '横浜ブルク13' }
};

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  var v = process.argv[i + 1];
  return (v == null || String(v).startsWith('--')) ? true : v;
}

/* 109シネマズ系（KINEZO とは別システム。lib/k109.js）。--theater のキーは上と共通の名前空間。 */
var THEATERS_109 = {
  kawasaki:         { chain: '109', alias: 'I1', name: '109シネマズ川崎' },
  premium_shinjuku: { chain: '109', alias: 'X1', name: '109シネマズプレミアム新宿' }
};
/* TOHOシネマズ（vit）。全73館を劇場コードで指定できる（--theater toho076）。
   主要館には読みやすい別名。一覧は runner/data/toho-theaters.json。 */
var TOHO_ALIAS = {
  toho_shinjuku: '076', toho_hibiya: '081', toho_shibuya: '043', toho_roppongi: '009', toho_ikebukuro: '084', toho_ueno: '080',
  toho_nihonbashi: '073', toho_tachikawa: '085', toho_kawasaki: '010', toho_lalaport_yokohama: '036', toho_ebina: '007'
};
function tohoTheater(key) {
  var code = TOHO_ALIAS[key] || ((key.match(/^toho[_-]?(\d{3})$/) || [])[1]);
  if (!code) return null;
  var list = []; try { list = require('./data/toho-theaters.json'); } catch (e) { list = []; }
  var t = list.find(function (x) { return x.code === code; });
  return { chain: 'toho', code: code, name: t ? t.name : ('TOHOシネマズ ' + code) };
}
/* チネチッタ川崎（SMART THEATER / cinerino API。lib/cinecitta.js。ゲスト購入） */
var THEATERS_OTHER = {
  cinecitta: { chain: 'cinecitta', project: 'cinecitta-production', theaterCode: '001', name: 'チネチッタ' },
  /* シネマサンシャイン（cinerino + COA。lib/sunshine.js。ゲスト購入） */
  gdcs: { chain: 'sunshine', theaterCode: '020', slug: 'gdcs', name: 'グランドシネマサンシャイン 池袋' }
};
var THEATER_KEY = String(arg('theater', 'yokohama')).toLowerCase();
var TH = THEATERS[THEATER_KEY] || THEATERS_109[THEATER_KEY] || THEATERS_OTHER[THEATER_KEY] || tohoTheater(THEATER_KEY);
if (!TH) { console.error('--theater は次から指定: ' + Object.keys(THEATERS).concat(Object.keys(THEATERS_109), Object.keys(THEATERS_OTHER), Object.keys(TOHO_ALIAS)).join(', ') + '（TOHO は toho<劇場コード3桁> でも可）'); process.exit(2); }
/** 劇場のチェーンに応じたアダプタを作る（どれも同じメソッド面を持つ） */
function makeAdapter(th) {
  if (th.chain === '109') return new K109({ alias: th.alias, name: th.name });
  if (th.chain === 'toho') return new Toho({ code: th.code, name: th.name });
  if (th.chain === 'cinecitta') return new Cinecitta({ project: th.project, theaterCode: th.theaterCode, name: th.name });
  if (th.chain === 'sunshine') return new Sunshine({ theaterCode: th.theaterCode, slug: th.slug, name: th.name });
  return new Kinezo({ theaterPath: th.path, theaterId: th.id });
}
/** 常駐ブラウザ（Brave/Chrome）を専用プロファイルで起動 or 再利用し、CDP で接続する */
async function openExternalBrowser(chromium, exe, profDir, launchArgs) {
  var port = parseInt(arg('cdp-port', '9333'), 10) || 9333;
  var http = require('http');
  function alive() {
    return new Promise(function (res) {
      var rq = http.get({ host: '127.0.0.1', port: port, path: '/json/version', timeout: 1500 }, function (r) { res(r.statusCode === 200); r.resume(); });
      rq.on('error', function () { res(false); }); rq.on('timeout', function () { rq.destroy(); res(false); });
    });
  }
  if (!(await alive())) {
    var spawn = require('child_process').spawn;
    var child = spawn(exe, launchArgs.concat(['--user-data-dir=' + profDir, '--remote-debugging-port=' + port, '--lang=ja', 'about:blank']), { detached: true, stdio: 'ignore' });
    child.unref();
    for (var i = 0; i < 80 && !(await alive()); i++) await sleep(250);
    if (!(await alive())) throw new Error('決済ブラウザ（' + exe + '）の起動を確認できません（CDP ' + port + '）');
  }
  var browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  var ctx = browser.contexts()[0] || await browser.newContext({ locale: 'ja-JP' });
  return { browser: browser, ctx: ctx, port: port };
}
/** 手元のブラウザ実行ファイルを探す（Windows / macOS の標準配置） */
function findBrowserExe(name) {
  var home = process.env.USERPROFILE || process.env.HOME || '';
  var local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  var pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  var cands = {
    brave: [path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    chrome: [path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    edge: [path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
  }[name] || [];
  for (var i = 0; i < cands.length; i++) { try { if (fs.existsSync(cands[i])) return cands[i]; } catch (e) {} }
  return null;
}
function ts() { var d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function fmtMs(t) { var d = new Date(t); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function log(msg) { console.log('[' + ts() + '] ' + msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function maskEmail(e) { var m = String(e).split('@'); return (m[0] || '').slice(0, 2) + '***@' + (m[1] || '').slice(0, 2) + '***'; }

/**
 * --seats を「優先グループ」に解析する。'/' 区切りで第1候補→第2候補…、
 * 各グループはカンマ区切りの席（人数分）。
 * 例) "A-3,A-4 / B-5,B-6 / C-7,C-8" → [[A-3,A-4],[B-5,B-6],[C-7,C-8]]
 */
function parseSeatGroups(str) {
  return String(str || '').split('/').map(function (g) {
    return g.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }).filter(function (g) { return g.length; });
}
function allAvail(map, g) { return g.every(function (id) { return map[id] && map[id].state === 'available'; }); }

/**
 * サーバ時刻(KINEZO)とローカル時計のズレを実測する（Date ヘッダの区間交差法）。
 * 返り値 offset = serverTime - localTime（ms）。ローカルがサーバより遅い＝offset は正。
 */
async function syncServerClock(k, samples) {
  var lo = -Infinity, hi = Infinity, got = 0;
  for (var i = 0; i < samples; i++) {
    var t0 = Date.now();
    var res = await request({ url: k.homeUrl(), jar: k.jar, headers: { 'Cache-Control': 'no-cache' } }).catch(function () { return null; });
    var t1 = Date.now();
    var d = res && res.headers && res.headers.date ? Date.parse(res.headers.date) : NaN;
    if (!isNaN(d)) {
      // サーバが秒 D を刻んだ瞬間、ローカル時計は [t0, t1] のどこか。区間を絞り込む。
      lo = Math.max(lo, d - t1);
      hi = Math.min(hi, d + 1000 - t0);
      got++;
    }
    await sleep(120);
  }
  if (!got || !isFinite(lo) || !isFinite(hi) || lo > hi) return { offset: 0, uncertainty: null };
  return { offset: Math.round((lo + hi) / 2), uncertainty: Math.round((hi - lo) / 2) };
}

/**
 * 目標ローカル時刻(絶対ms)まで精密に待つ。近づくほどスリープを細かくし、
 * 最後の数十msはビジースピンでミリ秒精度に寄せる。待機中は keepAlive を回す。
 * 発火した実時刻(ms)を返す。
 */
async function waitUntil(fireAt, keepAlive, onApproach, onEarly) {
  var lastPing = Date.now(), lastSec = -1, lastMin = -1, approached = false, early = false;
  while (true) {
    var remain = fireAt - Date.now();
    if (remain <= 0) break;
    // 発火の約20秒前に一度だけ「チェーン固有の先読み」（券種一覧など数秒かかるものをここで済ませる）
    if (onEarly && !early && remain <= 20000) {
      early = true;
      try { await onEarly(); } catch (e) { log('先読みで警告: ' + e.message); }
    }
    // 発火の約1.6秒前に一度だけ「接続ウォームアップ＋予約URL先読み」を実行
    if (onApproach && !approached && remain <= 1600) {
      approached = true;
      try { await onApproach(); } catch (e) { log('事前準備で警告: ' + e.message); }
    }
    if (keepAlive && remain > 5000 && Date.now() - lastPing > 180000) {
      lastPing = Date.now();
      try { await keepAlive(); } catch (e) { log('セッション維持で警告: ' + e.message); }
    }
    if (remain <= 10000) {
      var s = Math.ceil(remain / 1000);
      if (s !== lastSec) { lastSec = s; log('発火まで ' + s + ' 秒'); }
      if (remain > 1000) await sleep(Math.min(remain - 900, 250));
      else if (remain > 30) await sleep(5);
      // 残り30ms以下はビジースピン（await しない）でミリ秒精度に寄せる
    } else {
      var m = Math.round(remain / 60000);
      if (m !== lastMin) { lastMin = m; log('あと約 ' + m + ' 分'); }
      await sleep(Math.min(remain - 9500, 20000));
    }
  }
  return Date.now();
}

/** 対象上映回を1回だけ探す（予約導線が無ければ null）。 */
async function resolveShowOnce(k, date, title, time) {
  var sched = await k.fetchSchedule(date);
  // 同名作品が複数版（字幕/吹替/IMAX 等）あるので、部分一致した全作品から時刻一致の回を探す（完全一致タイトルを優先）
  var norm = function (t) { return String(t || '').replace(/^0/, ''); };
  var movies = sched.filter(function (m) { return m.title.indexOf(title) >= 0; });
  movies.sort(function (a, b) { return (a.title === title ? 0 : 1) - (b.title === title ? 0 : 1); });
  for (var i = 0; i < movies.length; i++) {
    var hit = movies[i].shows.find(function (s) { return norm(s.time) === norm(time) && s.reserveUrl; });
    if (hit) return hit;
  }
  return null;
}

/** 対象上映回を解決。発売直後は予約導線が出るまで遅延があるので短間隔でリトライ。 */
async function resolveShow(k, date, title, time) {
  for (var attempt = 0; attempt < 40; attempt++) {
    var show = await resolveShowOnce(k, date, title, time);
    if (show) return show;
    if (attempt === 0) log('予約導線を待っています…（発売直後の遅延を短間隔で追跡）');
    await sleep(150);
  }
  throw new Error('対象の予約導線が見つかりません（作品/時刻/発売状況を確認）: ' + title + ' ' + time);
}

/**
 * 予約フローを開き座席選択画面まで到達する。待機列/混雑は「単一接続で正直に」待つ。
 * 多重接続・列の追い越しはしない。CAPTCHA・想定外画面では停止して人間に引き継ぐ。
 * 詳細は cinema/QUEUE-RESEARCH.md。
 */
async function enterSeatMap(k, show, creds) {
  var MAXW = 10 * 60 * 1000; // 総待機の上限（10分）
  var t0 = Date.now(), waitingSince = 0, lastNote = 0, reloginTried = false;
  for (;;) {
    var op = await k.openShow(show);
    var html = k._seatHtml || '';
    var kind = op.ok ? 'seat' : k.pageKind(html, op.url || '');
    if (kind === 'seat') return op;
    if (Date.now() - t0 > MAXW) throw new Error('待機が上限(10分)を超えました。安全のため停止（画面: ' + (op.url || '') + '）');
    if (kind === 'waiting') {
      if (!waitingSince) { waitingSince = Date.now(); log('待機列/混雑を検出。単一接続で正直に順番を待ちます（多重接続・追い越しはしません）'); }
      if (Date.now() - lastNote > 15000) { lastNote = Date.now(); log('待機中…（経過 ' + Math.round((Date.now() - t0) / 1000) + '秒）'); }
      var sec = k.metaRefreshSec(html);
      await sleep(sec ? Math.max(1, Math.min(sec, 10)) * 1000 : 2000);
      continue;
    }
    if (kind === 'notonsale') { await sleep(300); continue; } // 発売枠に入るのを待つ
    if (kind === 'login') {
      if (!creds) throw new Error('ログイン画面に遷移しましたが認証情報がありません（ゲストで進めない上映回の可能性）。安全のため停止: ' + (op.url || ''));
      if (reloginTried) throw new Error('再ログイン後もログイン画面に戻されます。安全のため停止');
      reloginTried = true;
      log('セッション切れを検出。再ログインします');
      var re = await k.login(creds.email, creds.password);
      if (!re.ok) throw new Error('再ログイン失敗: ' + re.reason);
      continue;
    }
    if (kind === 'captcha') throw new Error('CAPTCHA/確認画面を検出。安全のため停止（手動で進めてください）: ' + (op.url || ''));
    throw new Error('予期せぬ画面に到達（' + (op.url || '') + '）。安全のため停止します');
  }
}

(async () => {
  var loginOnly = arg('login-only', false);
  var dry = arg('dry', false);
  var creds = loadCreds(TH.chain || 'kinezo'); // チェーン別の認証情報（混用しない）

  var k = makeAdapter(TH);
  await k.init();
  if (k.termsNote) log('※ ' + k.termsNote);

  // 1) ログイン（HTTP）。--at より前に済ませる＝発売時のロスにならない。
  //    認証情報が無いチェーン（TOHO など）はゲスト（ログインせずに購入）で進める。
  if (creds) {
    log('ログインします（' + maskEmail(creds.email) + '）');
    var lr = await k.login(creds.email, creds.password);
    if (!lr.ok && k.guestOk) { log('ログインできないためゲストで続行します: ' + lr.reason); creds = null; }
    else if (!lr.ok) { console.error('✗ ' + lr.reason); process.exit(2); }
    else log('✓ ' + lr.reason);
  } else {
    log('認証情報なし → ゲスト（ログインせずに購入）で進めます');
  }
  if (loginOnly) { log('--login-only のため終了します。'); return; }

  var date = arg('date'), title = arg('title'), time = arg('time');
  var groups = parseSeatGroups(arg('seats')); // 優先グループ（第1候補→第2候補…）
  if (!date || !title || !time || !groups.length) throw new Error('--date --title --time --seats を指定してください（--seats は "A-3,A-4 / B-5,B-6" で第2候補も指定可）');

  // 2) 発売時刻まで待機（サーバ時刻に同期して精密発火。待機中はセッション維持）
  //    発火の直前に ①予約URL先読み ②接続ウォームアップ を実行しておく。
  var at = arg('at');
  var clockOffset = 0;
  var preShow = null;
  if (at && at !== true) {
    var targetLocal = new Date(at).getTime();
    if (isNaN(targetLocal)) throw new Error('--at の時刻を解釈できません: ' + at);
    log('サーバ時刻に同期中…');
    var sync = await syncServerClock(k, 12);
    clockOffset = sync.offset; // server - local
    log('サーバ時計とのズレ: ローカルは ' + (clockOffset >= 0 ? 'サーバより ' + clockOffset + 'ms 遅い' : 'サーバより ' + (-clockOffset) + 'ms 速い') +
        (sync.uncertainty != null ? '（測定誤差 ±' + sync.uncertainty + 'ms）' : '（測定できず 0 とみなす）'));
    var fireAt = targetLocal - clockOffset; // ローカル時計でこの瞬間＝サーバ時刻で目標
    log('目標(発売): ' + fmtMs(targetLocal) + '（サーバ時刻基準）');
    log('発火予定: ローカル ' + fmtMs(fireAt) + ' に実行');
    var keepAlive = async function () {
      if (!creds) return; // ゲスト運用ではログイン維持は不要
      var ok = await k.isLoggedIn().catch(function () { return false; });
      if (ok) { log('セッション維持OK'); return; }
      log('セッションが切れたため再ログインします');
      var re = await k.login(creds.email, creds.password);
      log(re.ok ? '✓ 再ログイン成功' : '✗ 再ログイン失敗: ' + re.reason);
    };
    var prewarmed = false;
    // ③ チェーン固有の先読み（券種一覧・座席レイアウトなど発売前でも取れるもの。席の先取りはしない）。約20秒前に実行
    var onEarly = async function () {
      if (!k.prewarm) return;
      var ps = await resolveShowOnce(k, date, title, time).catch(function () { return null; });
      if (!ps) { log('先読み: 予約導線が未掲載のため T0 直前に再試行'); return; }
      var t0p = Date.now(); await k.prewarm(ps); prewarmed = true;
      log('先読み完了（券種・レイアウト等 ' + (Date.now() - t0p) + 'ms）');
    };
    var onApproach = async function () {
      // ② 接続ウォームアップ（TLS/DNSを温める）
      await request({ url: k.homeUrl(), jar: k.jar }).catch(function () {});
      // ① 予約URL先読み（発売前でも取れれば T=0 の番組表取得を省ける）
      preShow = await resolveShowOnce(k, date, title, time).catch(function () { return null; });
      if (preShow && k.prewarm && !prewarmed) { try { await k.prewarm(preShow); prewarmed = true; } catch (e) { log('先読み（prewarm）失敗・続行: ' + e.message); } }
      // (2) 取引の前倒し開始（SPA 型：passport→start。席には触れない＝先取りではない）
      if (k.prestart) { try { var ps2 = await k.prestart(); if (ps2 && ps2.ok) log('取引を前倒し開始（T0 は席の確保だけ）'); } catch (e) { log('取引の前倒し開始に失敗・T0 で開始: ' + e.message); } }
      log(preShow ? '事前準備OK（予約URLを先読み・接続ウォーム済み）' : '事前準備OK（接続ウォーム済み。予約URLは発売時に取得）');
    };
    var fired = await waitUntil(fireAt, keepAlive, onApproach, onEarly);
    var firedServer = fired + clockOffset;
    var diff = firedServer - targetLocal;
    log('発火: ローカル ' + fmtMs(fired) + ' ／ サーバ時刻換算 ' + fmtMs(firedServer) +
        ' → 目標との差 ' + (diff >= 0 ? '+' : '') + diff + ' ms');
  }

  // 3) 対象回を解決（先読み済みなら省略）→ 座席画面 → 席を掴む
  var t0 = Date.now();
  var show = preShow, dRes = 0;
  if (!show) { var tA = Date.now(); show = await resolveShow(k, date, title, time); dRes = Date.now() - tA; }
  log('対象: ' + title + ' ' + show.time + ' ｼｱﾀｰ' + show.screen + (preShow ? '（予約URL先読み済み）' : '（上映回解決 ' + dRes + 'ms）'));
  var tB = Date.now();
  var op = await enterSeatMap(k, show, creds); // 待機列は正直に待って座席画面まで到達
  var dOpen = Date.now() - tB;
  // (1) 第1候補は空席確認を飛ばして即確保（blindFirst 対応チェーン・本番のみ）。失敗したら座席表を取って従来どおり次候補へ
  var blindTried = false, sr = null, chosenSeats = null, chosenRank = 0, dSecure = 0;
  if (!dry && k.blindFirst && groups.length) {
    var tBl = Date.now();
    var bl = await k.secure(groups[0]);
    dSecure = Date.now() - tBl; blindTried = true;
    if (bl.ok) { sr = bl; chosenSeats = groups[0]; chosenRank = 1; log('第1候補を空席確認なしで即確保（' + dSecure + 'ms）'); }
    else log('第1候補 ' + groups[0].join(',') + ' は即確保できず（' + bl.reason + '）。座席表を取得して次候補へ');
  }
  var map = sr ? {} : await k.fetchSeatMap();
  // 優先順に「全席空いているグループ」を探す（第1候補→第2候補…）
  var firstOk = -1;
  for (var gi0 = (blindTried ? 1 : 0); gi0 < groups.length; gi0++) { if (allAvail(map, groups[gi0])) { firstOk = gi0; break; } }
  if (sr) firstOk = 0;
  if (firstOk < 0) {
    console.error('✗ どの候補席も確保できません（全グループに売切/存在しない席あり）');
    groups.forEach(function (g, i) {
      var miss = g.filter(function (id) { return !map[id] || map[id].state !== 'available'; });
      console.error('  第' + (i + 1) + '候補 ' + g.join(',') + ' → 不可: ' + miss.join(','));
    });
    console.error('  空席の例: ' + Object.keys(map).filter(function (id) { return map[id].state === 'available'; }).slice(0, 20).join(', '));
    process.exit(3);
  }

  // 4) 席を掴む（第1候補から。競合で失敗したら座席表を取り直して次候補へ）
  if (dry) {
    log('--dry。確保の直前で停止（席は取っていません）。確保予定: 第' + (firstOk + 1) + '候補 ' + groups[firstOk].join(',') +
        ' ｜ 内訳: 上映回解決 ' + dRes + 'ms／座席画面 ' + dOpen + 'ms');
    if (k.cancelTransaction) await k.cancelTransaction().catch(function () {}); // SPA 型は開いた取引を閉じておく
    return;
  }
  for (var gi = firstOk; gi < groups.length && !sr; gi++) {
    if (!allAvail(map, groups[gi])) continue;
    var tSec = Date.now();
    var attempt = await k.secure(groups[gi]);
    dSecure = Date.now() - tSec;
    if (attempt.ok) { sr = attempt; chosenSeats = groups[gi]; chosenRank = gi + 1; break; }
    log('第' + (gi + 1) + '候補 ' + groups[gi].join(',') + ' は確保できず（' + attempt.reason + '）。次候補を試します');
    await k.openShow(show); // 競合。座席表を取り直して残り候補の空きを最新化
    map = await k.fetchSeatMap();
  }
  if (!sr) { console.error('✗ すべての候補席を確保できませんでした（競合で埋まった可能性）'); process.exit(4); }
  log('✓✓ 席を掴みました＝勝敗確定（第' + chosenRank + '候補 / 座席確保 ' + dSecure + 'ms ｜ T0からの合計 ' + (Date.now() - t0) + 'ms ' +
      '＝解決 ' + dRes + '＋座席画面 ' + dOpen + '＋確保 ' + dSecure + 'ms）: ' + chosenSeats.join(', '));
  // 5) 券種選択画面へ前進（勝敗確定後の後処理。決済は人間）
  var tAdv = Date.now();
  var hr = await k.advanceToTicket();
  log('券種選択画面へ前進（' + (Date.now() - tAdv) + 'ms）');

  // 5) 同じセッションの Cookie をブラウザへ注入して決済画面を開く
  var chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) {
    console.log('\n席は確保済みですが、決済用ブラウザ(Playwright)が未導入です。');
    console.log('  cd runner && npm install && npx playwright install chromium');
    console.log('を実行後、ブラウザで ' + k.homeUrl() + ' にログインし、お手続き中の予約から決済してください。');
    console.log('（この端末のログインセッションは終了するため、仮予約は時間切れになる場合があります）');
    process.exit(0);
  }
  // 決済ブラウザ：既定は Brave（入っていれば）＋ runner 専用の「永続プロファイル」。
  //   一度ログイン／カードを保存すれば次回以降も残る（Chromium 136 以降は普段使いの既定プロファイルを自動操作できないため、専用プロファイルを使う）。
  //   --browser brave|chrome|chromium  --profile <dir>  --fresh（毎回まっさらな一時プロファイル）
  var launchArgs = ['--no-first-run', '--no-default-browser-check'];
  var want = String(arg('browser', '')).toLowerCase();
  var exe = findBrowserExe(want || 'brave') || (want ? findBrowserExe(want) : null);
  if (want && want !== 'chromium' && !exe) log('指定ブラウザ ' + want + ' が見つからないため Playwright 内蔵 Chromium で開きます');
  var ctx, browser = null, external = false;
  if (arg('fresh', false) === true) {
    browser = await chromium.launch(Object.assign({ headless: false, args: launchArgs }, exe ? { executablePath: exe } : {}));
    ctx = await browser.newContext({ locale: 'ja-JP' });
  } else {
    var profDir = path.resolve(String(arg('profile', path.join(__dirname, '.browser-profile', exe ? (want || 'brave') : 'chromium'))));
    try { fs.mkdirSync(profDir, { recursive: true }); } catch (e) {}
    if (exe) {
      // 常駐モード：Brave/Chrome を runner とは別プロセスで起動（起動済みなら再利用）し CDP で接続。runner が終了してもブラウザ・タブは残る
      var ext = await openExternalBrowser(chromium, exe, profDir, launchArgs);
      ctx = ext.ctx; external = true;
      log('決済ブラウザ: ' + exe + '（常駐・CDP ' + ext.port + '）／ プロファイル: ' + profDir + '（ログイン・カード情報はここに残ります）');
    } else {
      ctx = await chromium.launchPersistentContext(profDir, { headless: false, locale: 'ja-JP', viewport: null, args: launchArgs });
      log('決済ブラウザ: Playwright Chromium ／ プロファイル: ' + profDir + '（ログイン・カード情報はここに残ります）');
    }
  }
  await ctx.addCookies(k.jar.toPlaywrightCookies(k.base || BASE));
  if (k.prepareHandoff) await k.prepareHandoff().catch(function (e) { log('引き継ぎ情報の取得に失敗（続行）: ' + e.message); });
  if (k.handoffInitScript) await ctx.addInitScript(k.handoffInitScript()); // SPA 型（チネチッタ／シネマサンシャイン）は取引状態を sessionStorage に注入して引き継ぐ
  var page = (!external && ctx.pages && ctx.pages().length) ? ctx.pages()[0] : await ctx.newPage();
  var target = (k.handoffUrl && k.handoffUrl()) || hr.ticketUrl || (BASE + '/' + TH.path + '/reservation/choice_ticket');
  var hp = k.handoffPost && k.handoffPost();
  if (hp) {
    // POST 遷移専用ページ（TOHO の券種選択など）：まず同一オリジンの GET ページを開いてから、
    // 確保時と同じ POST フォームをブラウザから再送して次画面を表示する（Cookie は同一サイトで送られる）
    await page.goto(k.homeUrl(), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
    await page.evaluate(function (h) {
      var f = document.createElement('form'); f.method = 'POST'; f.action = h.action; f.acceptCharset = 'Shift_JIS';
      Object.keys(h.fields).forEach(function (key) { var i = document.createElement('input'); i.type = 'hidden'; i.name = key; i.value = h.fields[key]; f.appendChild(i); });
      document.body.appendChild(f); f.submit();
    }, hp).catch(function () {});
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(function () {});
    await sleep(1500); // 常駐ブラウザ終了前に POST 遷移を確実に着地させる
  } else {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
  }
  // 券種画面でなくログイン等に飛ばされたら、座席画面から続ける保険
  if (/\/login/.test(page.url())) {
    await page.goto(/^https?:/.test(show.reserveUrl) ? show.reserveUrl : (k.base || BASE) + show.reserveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
  }

  console.log('\n──────── 席を確保しました（このブラウザで決済してください） ────────');
  console.log('  作品: ' + title + ' / ' + date + ' ' + show.time + ' ｼｱﾀｰ' + show.screen);
  console.log('  座席: ' + chosenSeats.join(', ') + '（第' + chosenRank + '候補）');
  console.log('  現在の画面: ' + page.url());
  console.log('  ▶ この開いているウィンドウで券種を選び、決済まで進めてください。');
  console.log('  ※ カード情報はツールでは扱いません（人間が入力）。');
  console.log('  ※ 券種選択画面が出ていない場合は、同ウィンドウで「お手続き中の予約」から進めてください。');

  if (external) { log('ブラウザは常駐したまま runner を終了します（タブはそのまま残ります）'); await sleep(500); process.exit(0); }
  await new Promise(function () {}); // 決済のため開いたまま待機（終わったら閉じる / Ctrl+C）
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
