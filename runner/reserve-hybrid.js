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

var BASE = 'https://tjoy.jp';
var THEATER_PATH = 't-joy_yokohama';

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  var v = process.argv[i + 1];
  return (v == null || String(v).startsWith('--')) ? true : v;
}
function log(msg) { console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function maskEmail(e) { var m = String(e).split('@'); return (m[0] || '').slice(0, 2) + '***@' + (m[1] || '').slice(0, 2) + '***'; }

/**
 * 発売時刻まで待つ。待機中は keepAlive() を数分ごとに呼び、ログインを維持する
 * （長時間待つとセッションが切れるため）。keepAlive は省略可。
 */
async function waitUntil(iso, keepAlive) {
  var target = new Date(iso).getTime();
  if (isNaN(target)) throw new Error('--at の時刻を解釈できません: ' + iso);
  log('発売時刻まで待機: ' + new Date(target).toLocaleString('ja-JP') + '（ログインを維持しながら待ちます）');
  var lastPing = Date.now();
  var lastMinLog = 0;
  while (Date.now() < target) {
    var remain = target - Date.now();
    // 3分ごとにセッション維持
    if (keepAlive && remain > 5000 && Date.now() - lastPing > 180000) {
      lastPing = Date.now();
      try { await keepAlive(); } catch (e) { log('セッション維持で警告: ' + e.message); }
    }
    // 残り時間の表示は控えめに（1分ごと）
    if (remain > 60000 && Date.now() - lastMinLog > 60000) { lastMinLog = Date.now(); log('あと約 ' + Math.round(remain / 60000) + ' 分'); }
    if (remain > 60000) { await sleep(Math.min(remain - 30000, 20000)); }
    else if (remain > 3000) { await sleep(remain - 2000); }
    else { await sleep(50); }
  }
  log('発売時刻になりました。');
}

/** 対象上映回を解決。発売直後は予約導線が出るまで数百msの遅延があるので少しリトライ。 */
async function resolveShow(k, date, title, time) {
  for (var attempt = 0; attempt < 20; attempt++) {
    var sched = await k.fetchSchedule(date);
    var movie = sched.find(function (m) { return m.title.indexOf(title) >= 0; });
    if (movie) {
      var show = movie.shows.find(function (s) { return s.time === time && s.reserveUrl; });
      if (show) return show;
    }
    if (attempt === 0) log('予約導線を待っています…（発売直後は数百msの遅延あり）');
    await sleep(400);
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

  // 2) 発売時刻まで待機（ログイン済みで待つ。待機中はセッションを維持し、切れたら再ログイン）
  var at = arg('at');
  if (at && at !== true) {
    await waitUntil(at, async function () {
      var ok = await k.isLoggedIn().catch(function () { return false; });
      if (ok) { log('セッション維持OK'); return; }
      log('セッションが切れたため再ログインします');
      var re = await k.login(creds.email, creds.password);
      log(re.ok ? '✓ 再ログイン成功' : '✗ 再ログイン失敗: ' + re.reason);
    });
  }

  // 3) 対象回を解決 → 座席画面 → 希望席の空き確認（ここまで軽量）
  var t0 = Date.now();
  var show = await resolveShow(k, date, title, time);
  log('対象: ' + title + ' ' + show.time + ' ｼｱﾀｰ' + show.screen);
  var op = await k.openShow(show);
  if (!op.ok) throw new Error('座席選択画面に到達できませんでした（待機列/発売前の可能性）');
  var map = k.fetchSeatMap();
  var bad = seats.filter(function (id) { return !map[id] || map[id].state !== 'available'; });
  if (bad.length) {
    console.error('✗ 取得できない席（売切/存在しない）: ' + bad.join(', '));
    console.error('  空席の例: ' + Object.keys(map).filter(function (id) { return map[id].state === 'available'; }).slice(0, 20).join(', '));
    process.exit(3);
  }

  // 4) 確保（サブ秒）
  if (dry) { log('--dry。確保の直前で停止（席は取っていません）。'); return; }
  var hr = await k.hold(seats);
  if (!hr.ok) { console.error('✗ 確保失敗: ' + hr.reason); process.exit(4); }
  log('✓✓ 席を確保しました（所要 ' + (Date.now() - t0) + 'ms）: ' + seats.join(', '));

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
