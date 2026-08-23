#!/usr/bin/env node
/* ============================================================
   決済ブラウザの「ならし運転」ツアー
   ------------------------------------------------------------
   登録済みの劇場を1つずつ順番に、実際に runner（reserve-hybrid.js）で席を確保して
   決済ブラウザ（常駐 Brave・専用プロファイル）に引き継ぐ。各サイトで一度ログイン／
   カード情報を保存しておけば、以後の本番で入力の手間が無くなる。
   席は各サイトの取引期限（10〜15分）で自動解放される。決済はしない。

   使い方:
     node runner/warmup-tour.js                 # 全劇場（認証情報の無いチェーンは自動スキップ）
     node runner/warmup-tour.js gdcs cinecitta  # 指定した key だけ
     オプション: --days N（明日から N 日の範囲で上映回を探す・既定3） --only-guest（ログイン不要のチェーンだけ）
   ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { Kinezo } = require('./lib/kinezo');
const { K109 } = require('./lib/k109');
const { Toho } = require('./lib/toho');
const { Cinecitta } = require('./lib/cinecitta');
const { Sunshine } = require('./lib/sunshine');
const { loadCreds } = require('./config');

var argv = process.argv.slice(2);
function opt(n, d) { var i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; }
var DAYS = parseInt(opt('days', '3'), 10) || 3;
var ONLY_GUEST = argv.indexOf('--only-guest') >= 0;
var KEYS = argv.filter(function (a, i) { return !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && /^days$/.test(argv[i - 1].slice(2))); });

/* runner の --theater と同じ key（reserve-hybrid.js のテーブルに対応） */
var ALL = [
  { key: 'yokohama', chain: 'kinezo', mk: function () { return new Kinezo({ theaterPath: 't-joy_yokohama', theaterId: '190' }); } },
  { key: 'wald9', chain: 'kinezo', mk: function () { return new Kinezo({ theaterPath: 'shinjuku_wald9', theaterId: '140' }); } },
  { key: 'kyoto', chain: 'kinezo', mk: function () { return new Kinezo({ theaterPath: 't-joy_kyoto', theaterId: '360' }); } },
  { key: 'umeda', chain: 'kinezo', mk: function () { return new Kinezo({ theaterPath: 't-joy_umeda', theaterId: '320' }); } },
  { key: 'burg13', chain: 'kinezo', mk: function () { return new Kinezo({ theaterPath: 'yokohama_burg13', theaterId: '170' }); } },
  { key: 'kawasaki', chain: '109', mk: function () { return new K109({ alias: 'I1', name: '109シネマズ川崎' }); } },
  { key: 'premium_shinjuku', chain: '109', mk: function () { return new K109({ alias: 'X1', name: '109シネマズプレミアム新宿' }); } },
  { key: 'toho_shinjuku', chain: 'toho', mk: function () { return new Toho({ code: '076' }); } },
  { key: 'toho_hibiya', chain: 'toho', mk: function () { return new Toho({ code: '081' }); } },
  { key: 'toho_shibuya', chain: 'toho', mk: function () { return new Toho({ code: '043' }); } },
  { key: 'toho_roppongi', chain: 'toho', mk: function () { return new Toho({ code: '009' }); } },
  { key: 'toho_ikebukuro', chain: 'toho', mk: function () { return new Toho({ code: '084' }); } },
  { key: 'toho_kawasaki', chain: 'toho', mk: function () { return new Toho({ code: '010' }); } },
  { key: 'cinecitta', chain: 'cinecitta', mk: function () { return new Cinecitta({}); } },
  { key: 'gdcs', chain: 'sunshine', mk: function () { return new Sunshine({}); } }
];
var GUEST_CHAINS = { toho: 1, cinecitta: 1, sunshine: 1 };

function dateStr(d) { return new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10); }
function log(m) { console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + m); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** その劇場で「空席の多い上映回」と「最後列の隣り合う2席」を選ぶ */
async function pickTarget(t) {
  var k = t.mk(); await k.init();
  var cands = [];
  for (var d = 1; d <= DAYS; d++) {
    var ds = dateStr(d); var mv;
    try { mv = await k.fetchSchedule(ds); } catch (e) { continue; }
    mv.forEach(function (m) { m.shows.forEach(function (s) {
      if (!s.reserveUrl) return;
      if (s.onSale && Date.now() < new Date(s.onSale).getTime()) return;
      if (s.status && /X|W/.test(s.status)) return;
      cands.push({ title: m.title, show: s, rem: (s.remaining != null ? s.remaining : (s.allSeats || 0)) });
    }); });
    if (cands.length >= 20) break;
  }
  if (!cands.length) throw new Error('発売中の上映回が見つかりません');
  cands.sort(function (a, b) { return b.rem - a.rem; });
  // 上位から順に座席表が取れて空きがある回を採用
  for (var i = 0; i < Math.min(cands.length, 6); i++) {
    var c = cands[i];
    try {
      var op = await k.openShow(c.show); if (op && op.ok === false) continue;
      var map = await k.fetchSeatMap();
      // 車椅子スペース（HC 行／type wheelchair）は絶対に選ばない
      var av = Object.keys(map).filter(function (id) { return map[id].state === 'available' && !map[id].wheelchair && map[id].type !== 'wheelchair' && !/^HC/.test(id) && /^[A-Z]+-\d+$/.test(id); });
      if (av.length < 2) continue;
      // 最後列（アルファベット最大）の隣り合う2席
      var byRow = {}; av.forEach(function (id) { var m = id.match(/^([A-Z]+)-(\d+)$/); (byRow[m[1]] = byRow[m[1]] || []).push(+m[2]); });
      var rows = Object.keys(byRow).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); });
      var pair = null;
      for (var r = rows.length - 1; r >= 0 && !pair; r--) {
        var nums = byRow[rows[r]].sort(function (a, b) { return a - b; });
        for (var j = nums.length - 1; j > 0; j--) { if (nums[j] - nums[j - 1] === 1) { pair = [rows[r] + '-' + nums[j - 1], rows[r] + '-' + nums[j]]; break; } }
      }
      var seats = pair ? pair.join(',') : av[av.length - 1];
      if (k.cancelTransaction) await k.cancelTransaction().catch(function () {});
      return { date: c.show.date, title: c.title, time: c.show.time, seats: seats, screen: c.show.screenName || c.show.screen, avail: av.length };
    } catch (e) { /* 次の候補 */ }
  }
  throw new Error('座席表が取れる上映回がありません');
}

function runRunner(t, tg) {
  return new Promise(function (resolve) {
    var args = [path.join(__dirname, 'reserve-hybrid.js'), '--theater', t.key, '--date', tg.date, '--title', tg.title, '--time', tg.time, '--seats', tg.seats];
    var out = '', p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    var timer = setTimeout(function () { out += '\n[tour] 3分で応答なし → 打ち切り'; try { p.kill(); } catch (e) {} }, 180000);
    p.stdout.on('data', function (d) { out += d; process.stdout.write(d); });
    p.stderr.on('data', function (d) { out += d; process.stderr.write(d); });
    p.on('close', function (code) { clearTimeout(timer); resolve({ code: code, out: out }); });
  });
}

(async function () {
  var list = ALL.filter(function (t) { return !KEYS.length || KEYS.indexOf(t.key) >= 0; });
  var results = [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    console.log('\n══════ ' + (i + 1) + '/' + list.length + ' ' + t.key + ' (' + t.chain + ') ══════');
    if (!GUEST_CHAINS[t.chain]) {
      if (ONLY_GUEST) { results.push([t.key, 'skip(要ログイン)']); log('スキップ（--only-guest）'); continue; }
      try { if (!loadCreds(t.chain)) throw new Error('none'); } catch (e) { results.push([t.key, 'skip(認証情報なし)']); log('スキップ：' + t.chain + ' の認証情報が runner/.env にありません'); continue; }
    }
    var tg;
    try { tg = await pickTarget(t); }
    catch (e) { results.push([t.key, 'skip(' + e.message + ')']); log('スキップ：' + e.message); continue; }
    log('対象: ' + tg.date + ' ' + tg.time + ' ' + tg.title + ' ｜ ' + tg.screen + ' ｜ 席 ' + tg.seats + '（空席 ' + tg.avail + '）');
    var r = await runRunner(t, tg);
    var ok = /席を確保しました/.test(r.out);
    results.push([t.key, ok ? 'OK ' + tg.seats : 'NG(code ' + r.code + ')']);
    await sleep(1500);
  }
  console.log('\n════════ 結果 ════════');
  results.forEach(function (x) { console.log('  ' + x[0].padEnd(18) + x[1]); });
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
