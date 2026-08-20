#!/usr/bin/env node
/* ============================================================
   KINEZO 予約（可視ブラウザ版 / Playwright）
   ------------------------------------------------------------
   純Node版（reserve.js）は「席確保→決済」でセッション引き継ぎができない
   （仮予約は実行時のログインセッションに紐づき、別ブラウザに出てこない）。
   本スクリプトは実ブラウザを1つ立ち上げ、ログイン→席確保まで自動で行い、
   そのまま画面を開いたままにする。決済はその同じウィンドウで人間が続ける。
   ＝掴むのも払うのも同一セッションなので引き継ぎ問題が起きない。

   前提: 手元PCに Playwright を入れる
     cd runner && npm install && npx playwright install chromium

   認証情報は config.js が手元(env / runner/.env)からのみ読む。クラウドには渡さない。

   使い方:
     # ①ログイン確認だけ（席は触らない。開いたら10秒で閉じる）
     node runner/reserve-browser.js --login-only

     # ②予行演習：ログイン→座席画面→席クリックまで（確保ボタンは押さない）
     node runner/reserve-browser.js --date 2026-08-21 --title オークストリート \
        --time 15:00 --seats A-3 --dry

     # ③本番：席を確保してブラウザは開いたまま（人間が決済）
     node runner/reserve-browser.js --date 2026-08-21 --title オークストリート \
        --time 15:00 --seats A-3

     # ④発売時刻に確保（先にログインして待機。PCはつけておく）
     node runner/reserve-browser.js --date 2026-08-27 --title ユーフォニアム \
        --time 10:00 --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"
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

async function waitUntil(iso) {
  var target = new Date(iso).getTime();
  if (isNaN(target)) throw new Error('--at の時刻を解釈できません: ' + iso);
  log('発売時刻まで待機: ' + new Date(target).toLocaleString('ja-JP'));
  while (Date.now() < target) {
    var remain = target - Date.now();
    if (remain > 60000) { log('あと約 ' + Math.round(remain / 60000) + ' 分'); await sleep(Math.min(remain - 30000, 60000)); }
    else if (remain > 3000) { await sleep(remain - 2000); }
    else { await sleep(50); }
  }
  log('発売時刻になりました。');
}

(async () => {
  var chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) {
    console.error('Playwright が見つかりません。先に導入してください:\n  cd runner && npm install && npx playwright install chromium');
    process.exit(10);
  }

  var loginOnly = arg('login-only', false);
  var dry = arg('dry', false);
  var creds = loadCreds();

  var browser = await chromium.launch({ headless: false, args: ['--no-first-run', '--no-default-browser-check'] });
  var ctx = await browser.newContext({ locale: 'ja-JP' });

  // 速度最適化（任意）: フォント/メディアの読み込みを止める。
  // ※ 座席表の「画像」は既定で読み込む。KINEZO は座席マップ画像の onload で
  //   「読み込み中」オーバーレイを消すため、画像を止めると画面がローディングのまま
  //   固まって見える。だから画像はブロックしない。
  //   さらに削りたい上級者向けに KINEZO_BLOCK_IMAGES=1 で画像も止められる。
  var blockImages = !!process.env.KINEZO_BLOCK_IMAGES;
  await ctx.route('**/*', function (route) {
    var t = route.request().resourceType();
    if (t === 'media' || t === 'font') return route.abort();
    if (blockImages && t === 'image') return route.abort();
    return route.continue();
  });

  var page = await ctx.newPage();

  try {
    // 1) ログイン
    log('ブラウザを起動、ログインします（' + maskEmail(creds.email) + '）');
    await page.goto(BASE + '/' + THEATER_PATH + '/login', { waitUntil: 'domcontentloaded' });
    if (await page.locator('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]').count()) {
      log('CAPTCHA を検出。自動ログインは中止、人間が手動でログインしてください（ブラウザは開いたまま）。');
      if (loginOnly) { await sleep(600000); }
      return;
    }
    await page.fill('input[name="email"]', creds.email);
    await page.fill('input[name="password"]', creds.password);
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(function () {}),
      page.click('#btn-login-submit')
    ]);
    await page.waitForTimeout(300);
    var loggedIn = !/\/login(\/|$)/.test(page.url()) || !(await page.locator('input[name="password"]').count());
    if (!loggedIn) {
      log('✗ ログインに失敗した可能性があります。メール/パスワードをご確認ください（ブラウザは開いたまま）。');
      await sleep(600000);
      return;
    }
    log('✓ ログイン成功');
    if (loginOnly) { log('--login-only。10秒後に閉じます。'); await sleep(10000); return; }

    // 2) プラン
    var date = arg('date'), title = arg('title'), time = arg('time');
    var seats = String(arg('seats') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!date || !title || !time || !seats.length) throw new Error('--date --title --time --seats を指定してください');

    // 3) 発売時刻まで待機（ログイン済みで待つ）
    var at = arg('at');
    if (at && at !== true) await waitUntil(at);

    // 4) 対象上映回の予約URLを解決（公開スケジュールAPI。認証不要）
    var k = new Kinezo({ theaterPath: THEATER_PATH, theaterId: '190' });
    await k.init();
    var sched = await k.fetchSchedule(date);
    var movie = sched.find(function (m) { return m.title.indexOf(title) >= 0; });
    if (!movie) throw new Error('作品が見つかりません（' + title + '）。候補: ' + sched.map(function (m) { return m.title; }).join(' / '));
    var show = movie.shows.find(function (s) { return s.time === time; });
    if (!show) throw new Error('その時刻の回がありません（' + time + '）。候補: ' + movie.shows.map(function (s) { return s.time; }).join(' / '));
    log('対象: ' + movie.title + ' ' + show.time + ' ｼｱﾀｰ' + show.screen);

    // 5) 予約フロー入口 → choice_seat（ログイン済みブラウザで）
    await page.goto(BASE + show.reserveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function () {});
    await dismissModals(page);
    if (!/choice_seat/.test(page.url())) {
      log('注意: 座席選択画面に自動遷移しませんでした（発売前/待機列/規約同意の可能性）。現在: ' + page.url());
      log('必要なら画面の指示に従って座席選択まで進めてください。ブラウザは開いたままにします。');
    }

    // 座席表の準備を待つ（networkidle は使わない＝広告/決済タグの通信で待たされるため）。
    // 実際に必要なのは座席の <area> が生成されていること。
    await page.waitForSelector('area.seat-select', { timeout: 15000 }).catch(function () {});

    // 6) 席をクリック（image-map の area。可視判定を避けて確実に選択）
    for (var i = 0; i < seats.length; i++) {
      await clickSeat(page, seats[i]);
      log('席を選択: ' + seats[i] + '（現在の選択数 ' + (await seatCount(page)) + '）');
    }

    // 7) 確保（--dry は押さない）
    if (dry) {
      log('--dry。席の選択まで確認しました（確保ボタンは押していません）。10秒後に閉じます。');
      await sleep(10000);
      return;
    }
    await dismissModals(page);
    await page.click('#seatChoice');
    await page.waitForURL(/choice_ticket/, { timeout: 20000 }).catch(function () {});

    console.log('\n──────── 席を確保しました（このブラウザで決済してください） ────────');
    console.log('  作品: ' + movie.title);
    console.log('  日時: ' + date + ' ' + show.time + ' / ｼｱﾀｰ' + show.screen);
    console.log('  座席: ' + seats.join(', '));
    console.log('  現在の画面: ' + page.url());
    console.log('  ▶ この開いているウィンドウで券種を選び、決済まで進めてください。');
    console.log('  ※ カード情報はツールでは扱いません（人間が入力）。');
    console.log('  ※ 決済が終わったらブラウザを閉じてOK。仮予約には時間制限があります。');

    // 決済のためブラウザは閉じない。プロセスは開いたまま待機。
    await new Promise(function () {});
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('（問題調査のためブラウザは開いたままにします。確認後このターミナルで Ctrl+C）');
    await new Promise(function () {});
  }
})();

/** 現在の選択座席数（#seatLength の値）。取れなければ 0。 */
async function seatCount(page) {
  var v = await page.locator('#seatLength').inputValue().catch(function () { return '0'; });
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 座席（image-map の <area>）を選択する。area は不可視要素扱いになるため、
 * 通常 click は効かない。3段構えで試し、#seatLength が増えたら成功と判定。
 *   ① click イベントを直接 dispatch（サイトの選択ハンドラを起動）
 *   ② area の座標を画像上の位置に換算して実クリック（image-map 本来の動作）
 *   ③ force click
 */
async function clickSeat(page, seatId) {
  var sel = 'area#' + seatId.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  var loc = page.locator(sel);
  if (!(await loc.count())) throw new Error('席が見つかりません: ' + seatId + '（席IDが実在するか、この回のシアターか確認）');
  var cls = (await loc.getAttribute('class')) || '';
  if (/sold-out/.test(cls)) throw new Error('席が売切です: ' + seatId);

  var before = await seatCount(page);

  // ① click を dispatch
  await loc.dispatchEvent('click').catch(function () {});
  await page.waitForTimeout(200);
  if ((await seatCount(page)) > before) return;

  // ② 座標クリック（画像の表示サイズに合わせて換算）
  var info = await loc.evaluate(function (area) {
    var raw = area.getAttribute('data-coords') || area.getAttribute('coords') || '';
    var c = raw.split(',').map(Number);
    var map = area.closest('map');
    var name = map ? map.getAttribute('name') : null;
    var img = name ? document.querySelector('img[usemap="#' + name + '"]') : null;
    if (!img || c.length < 4) return null;
    var r = img.getBoundingClientRect();
    return { cx: (c[0] + c[2]) / 2, cy: (c[1] + c[3]) / 2, natW: img.naturalWidth || r.width, natH: img.naturalHeight || r.height, rx: r.x, ry: r.y, rw: r.width, rh: r.height };
  }).catch(function () { return null; });
  if (info && info.rw > 0 && info.natW > 0) {
    var px = info.rx + info.cx * (info.rw / info.natW);
    var py = info.ry + info.cy * (info.rh / info.natH);
    await page.mouse.click(px, py).catch(function () {});
    await page.waitForTimeout(200);
    if ((await seatCount(page)) > before) return;
  }

  // ③ force click
  await loc.click({ force: true, timeout: 3000 }).catch(function () {});
  await page.waitForTimeout(200);
  if ((await seatCount(page)) > before) return;

  throw new Error('席を選択できませんでした（クリックは実行したが選択数が増えない）: ' + seatId +
    '。座席表の描画待ちが足りない可能性。もう一度実行するか、画面を確認してください。');
}

/** 規約同意・案内などのモーダルを best-effort で閉じる/同意する */
async function dismissModals(page) {
  var buttons = ['#myModalTlsButton', '.modal.show .btn-primary', '.modal.show .btn-danger',
    'button:has-text("同意")', 'button:has-text("同意する")', 'button:has-text("OK")', 'button:has-text("閉じる")'];
  for (var i = 0; i < buttons.length; i++) {
    try {
      var loc = page.locator(buttons[i]);
      if (await loc.count() && await loc.first().isVisible()) { await loc.first().click({ timeout: 1500 }); await page.waitForTimeout(300); }
    } catch (e) { /* ignore */ }
  }
}
