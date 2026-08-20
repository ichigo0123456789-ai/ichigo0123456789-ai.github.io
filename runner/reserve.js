#!/usr/bin/env node
/* ============================================================
   KINEZO 予約オーケストレータ（手元PCで実行）
   ------------------------------------------------------------
   発売時刻の前にPCで起動しておき、時刻ちょうどに席を確保する。
   認証情報は手元(env / runner/.env)からのみ読み、クラウドには渡らない。
   決済（券種選択以降）は人間がブラウザで完了する設計＝カード情報は扱わない。

   使い方:
     # ① まずログインだけ確認（席は触らない）
     node runner/reserve.js --login-only

     # ② 予行演習：ログイン→座席確認まで（実際には確保しない）
     node runner/reserve.js --date 2026-08-21 --title オークストリート --time 15:00 --seats A-2,A-3 --dry

     # ③ 本番：今すぐ確保
     node runner/reserve.js --date 2026-08-21 --title オークストリート --time 15:00 --seats A-2,A-3

     # ④ 本番：発売時刻ちょうどに確保（それまで待機。PCはつけておく）
     node runner/reserve.js --date 2026-08-27 --title ユーフォニアム --time 10:00 \
        --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"

   オプション:
     --date YYYY-MM-DD   上映日
     --title 文字列       作品名の部分一致（1件に絞れる程度に）
     --time HH:MM        開映時刻
     --seats A-2,A-3     確保する席（area の id 形式。カンマ区切り）
     --at ISO時刻         この時刻まで待ってから確保（発売時刻を指定）
     --dry               確保の直前で止める（安全な予行演習）
     --login-only        ログイン確認のみ
   ============================================================ */
'use strict';

const { Kinezo } = require('./lib/kinezo');
const { loadCreds } = require('./config');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  var v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}
function log(msg) { console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + msg); }

/** 目標時刻(ISO)まで待つ。残り時間を時々表示。 */
async function waitUntil(iso) {
  var target = new Date(iso).getTime();
  if (isNaN(target)) throw new Error('--at の時刻を解釈できません: ' + iso);
  log('発売時刻まで待機します: ' + new Date(target).toLocaleString('ja-JP'));
  while (true) {
    var remain = target - Date.now();
    if (remain <= 0) break;
    if (remain > 60000) { log('あと約 ' + Math.round(remain / 60000) + ' 分'); await sleep(Math.min(remain - 30000, 60000)); }
    else if (remain > 3000) { await sleep(remain - 2000); }
    else { await sleep(50); }
  }
  log('発売時刻になりました。確保を開始します。');
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async () => {
  var loginOnly = arg('login-only', false);
  var dry = arg('dry', false);
  var creds = loadCreds();  // 値はここから先も一切表示しない

  var k = new Kinezo({ theaterPath: 't-joy_yokohama', theaterId: '190' });
  await k.init();

  // 1) ログイン
  log('ログインします（ユーザー: ' + maskEmail(creds.email) + '）');
  var lr = await k.login(creds.email, creds.password);
  if (!lr.ok) { console.error('✗ ' + lr.reason); process.exit(2); }
  log('✓ ' + lr.reason);
  if (loginOnly) { log('--login-only のため終了します。'); return; }

  // 2) プラン確認
  var date = arg('date'); var title = arg('title'); var time = arg('time');
  var seats = String(arg('seats') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!date || !title || !time || !seats.length) {
    throw new Error('--date --title --time --seats を指定してください（--login-only を除く）');
  }

  // 3) （指定があれば）発売時刻まで待機
  var at = arg('at');
  if (at && at !== true) await waitUntil(at);

  // 4) 対象上映回を特定
  var sched = await k.fetchSchedule(date);
  var movie = sched.find(function (m) { return m.title.indexOf(title) >= 0; });
  if (!movie) throw new Error('作品が見つかりません（' + title + '）。候補: ' + sched.map(function (m) { return m.title; }).join(' / '));
  var show = movie.shows.find(function (s) { return s.time === time; });
  if (!show) throw new Error('その時刻の回がありません（' + time + '）。候補: ' + movie.shows.map(function (s) { return s.time; }).join(' / '));
  log('対象: ' + movie.title + ' ' + show.time + ' ｼｱﾀｰ' + show.screen);

  // 5) 座席画面を開く
  var op = await k.openShow(show);
  if (!op.ok) throw new Error('座席選択画面に到達できませんでした（発売前 or 待機列の可能性）');
  var map = k.fetchSeatMap();

  // 6) 希望席の空き確認
  var unavailable = seats.filter(function (id) { return !map[id] || map[id].state !== 'available'; });
  if (unavailable.length) {
    console.error('✗ 次の席は取得できません（売切/存在しない）: ' + unavailable.join(', '));
    console.error('  空席の例: ' + Object.keys(map).filter(function (id) { return map[id].state === 'available'; }).slice(0, 20).join(', '));
    process.exit(3);
  }
  log('希望席すべて空席: ' + seats.join(', '));

  // 7) 確保
  if (dry) { log('--dry のためここで停止（実際の確保はしていません）。'); return; }
  var hr = await k.hold(seats);
  if (!hr.ok) { console.error('✗ 確保できませんでした: ' + hr.reason); process.exit(4); }
  log('✓✓ ' + hr.reason);
  console.log('\n──────── 席を確保しました ────────');
  console.log('  作品: ' + movie.title);
  console.log('  日時: ' + date + ' ' + show.time + ' / ｼｱﾀｰ' + show.screen);
  console.log('  座席: ' + seats.join(', '));
  console.log('  続きURL(券種・決済): ' + (hr.ticketUrl || '(ブラウザでKINEZOにログインし予約手続き中の回を開いてください)'));
  console.log('  ※ 仮予約には時間制限があります。ブラウザで速やかに決済してください。');
  console.log('  ※ カード情報はこのツールでは一切扱いません（人間が決済）。');
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });

/** ログ用にメールを伏せる（例: ab***@ex***） */
function maskEmail(email) {
  var m = String(email).split('@');
  var u = m[0] || ''; var d = m[1] || '';
  return (u.slice(0, 2) + '***') + '@' + (d.slice(0, 2) + '***');
}
