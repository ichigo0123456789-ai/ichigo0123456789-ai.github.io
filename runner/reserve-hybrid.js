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
   ============================================================ */
'use strict';

const { Kinezo } = require('./lib/kinezo');
const { loadCreds } = require('./config');
const { request } = require('./lib/http');

var BASE = 'https://tjoy.jp';
var THEATER_PATH = 't-joy_yokohama';

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  var v = process.argv[i + 1];
  return (v == null || String(v).startsWith('--')) ? true : v;
}
function ts() { var d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function fmtMs(t) { var d = new Date(t); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); }
function log(msg) { console.log('[' + ts() + '] ' + msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function maskEmail(e) { var m = String(e).split('@'); return (m[0] || '').slice(0, 2) + '***@' + (m[1] || '').slice(0, 2) + '***'; }

/**
 * サーバ時刻(KINEZO)とローカル時計のズレを実測する（Date ヘッダの区間交差法）。
 * 返り値 offset = serverTime - localTime（ms）。ローカルがサーバより遅い＝offset は正。
 */
async function syncServerClock(k, samples) {
  var lo = -Infinity, hi = Infinity, got = 0;
  for (var i = 0; i < samples; i++) {
    var t0 = Date.now();
    var res = await request({ url: BASE + '/' + THEATER_PATH, jar: k.jar, headers: { 'Cache-Control': 'no-cache' } }).catch(function () { return null; });
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
async function waitUntil(fireAt, keepAlive, onApproach) {
  var lastPing = Date.now(), lastSec = -1, lastMin = -1, approached = false;
  while (true) {
    var remain = fireAt - Date.now();
    if (remain <= 0) break;
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
  var movie = sched.find(function (m) { return m.title.indexOf(title) >= 0; });
  if (!movie) return null;
  return movie.shows.find(function (s) { return s.time === time && s.reserveUrl; }) || null;
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

(async () => {
  var loginOnly = arg('login-only', false);
  var dry = arg('dry', false);
  var creds = loadCreds();

  var k = new Kinezo({ theaterPath: THEATER_PATH, theaterId: '190' });
  await k.init();

  // 1) ログイン（HTTP）。--at より前に済ませる＝発売時のロスにならない。
  log('ログインします（' + maskEmail(creds.email) + '）');
  var lr = await k.login(creds.email, creds.password);
  if (!lr.ok) { console.error('✗ ' + lr.reason); process.exit(2); }
  log('✓ ' + lr.reason);
  if (loginOnly) { log('--login-only のため終了します。'); return; }

  var date = arg('date'), title = arg('title'), time = arg('time');
  var seats = String(arg('seats') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!date || !title || !time || !seats.length) throw new Error('--date --title --time --seats を指定してください');

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
      var ok = await k.isLoggedIn().catch(function () { return false; });
      if (ok) { log('セッション維持OK'); return; }
      log('セッションが切れたため再ログインします');
      var re = await k.login(creds.email, creds.password);
      log(re.ok ? '✓ 再ログイン成功' : '✗ 再ログイン失敗: ' + re.reason);
    };
    var onApproach = async function () {
      // ② 接続ウォームアップ（TLS/DNSを温める）
      await request({ url: BASE + '/' + THEATER_PATH, jar: k.jar }).catch(function () {});
      // ① 予約URL先読み（発売前でも取れれば T=0 の番組表取得を省ける）
      preShow = await resolveShowOnce(k, date, title, time).catch(function () { return null; });
      log(preShow ? '事前準備OK（予約URLを先読み・接続ウォーム済み）' : '事前準備OK（接続ウォーム済み。予約URLは発売時に取得）');
    };
    var fired = await waitUntil(fireAt, keepAlive, onApproach);
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
  var op = await k.openShow(show);
  var dOpen = Date.now() - tB;
  if (!op.ok) throw new Error('座席選択画面に到達できませんでした（待機列/発売前の可能性）');
  var map = k.fetchSeatMap();
  var bad = seats.filter(function (id) { return !map[id] || map[id].state !== 'available'; });
  if (bad.length) {
    console.error('✗ 取得できない席（売切/存在しない）: ' + bad.join(', '));
    console.error('  空席の例: ' + Object.keys(map).filter(function (id) { return map[id].state === 'available'; }).slice(0, 20).join(', '));
    process.exit(3);
  }

  // 4) 席を掴む（choiceSeatSave＝勝敗の決まる点）
  if (dry) { log('--dry。確保の直前で停止（席は取っていません）。内訳: 上映回解決 ' + dRes + 'ms／座席画面 ' + dOpen + 'ms'); return; }
  var tSec = Date.now();
  var sr = await k.secure(seats);
  var dSecure = Date.now() - tSec;
  if (!sr.ok) { console.error('✗ 確保失敗: ' + sr.reason); process.exit(4); }
  log('✓✓ 席を掴みました＝勝敗確定（座席確保 ' + dSecure + 'ms ｜ T0からの合計 ' + (Date.now() - t0) + 'ms ' +
      '＝解決 ' + dRes + '＋座席画面 ' + dOpen + '＋確保 ' + dSecure + 'ms）: ' + seats.join(', '));
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
    console.log('を実行後、ブラウザで ' + BASE + '/' + THEATER_PATH + ' にログインし、お手続き中の予約から決済してください。');
    console.log('（この端末のログインセッションは終了するため、仮予約は時間切れになる場合があります）');
    process.exit(0);
  }
  var browser = await chromium.launch({ headless: false, args: ['--no-first-run', '--no-default-browser-check'] });
  var ctx = await browser.newContext({ locale: 'ja-JP' });
  await ctx.addCookies(k.jar.toPlaywrightCookies(BASE));
  var page = await ctx.newPage();
  var target = hr.ticketUrl && /choice_ticket/.test(hr.ticketUrl) ? hr.ticketUrl : (BASE + '/' + THEATER_PATH + '/reservation/choice_ticket');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
  // 券種画面でなくログイン等に飛ばされたら、座席画面から続ける保険
  if (/\/login/.test(page.url())) {
    await page.goto(BASE + show.reserveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
  }

  console.log('\n──────── 席を確保しました（このブラウザで決済してください） ────────');
  console.log('  作品: ' + title + ' / ' + date + ' ' + show.time + ' ｼｱﾀｰ' + show.screen);
  console.log('  座席: ' + seats.join(', '));
  console.log('  現在の画面: ' + page.url());
  console.log('  ▶ この開いているウィンドウで券種を選び、決済まで進めてください。');
  console.log('  ※ カード情報はツールでは扱いません（人間が入力）。');
  console.log('  ※ 券種選択画面が出ていない場合は、同ウィンドウで「お手続き中の予約」から進めてください。');

  await new Promise(function () {}); // 決済のため開いたまま待機（終わったら閉じる / Ctrl+C）
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
