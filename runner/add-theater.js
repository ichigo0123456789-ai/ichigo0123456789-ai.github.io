#!/usr/bin/env node
/* ============================================================
   劇場の自動追加ツール（トークン節約用・手作業ゼロ / KINEZO・109 両対応）
   ------------------------------------------------------------
   実サイトから全スクリーンの座席表を採取して
   1) cinema/data/theaters.js に劇場エントリを挿入（row() 圧縮形式）
   2) runner/reserve-hybrid.js の THEATERS（KINEZO）/ THEATERS_109 にキーを追加
   を自動で行う。出力は要約のみ。サイト側は各エントリの runnerKey を参照する。

   使い方:
     node runner/add-theater.js <spec> <key> "<劇場名>" "<エリア>" "<都道府県>" [mapX mapY] [--chain kinezo|109] [--days N]
       spec … KINEZO: 劇場パス(例 t-joy_kyoto) / 109: サイト別名(例 I1)
   例:
     node runner/add-theater.js t-joy_kyoto kyoto "T・ジョイ京都" "京都 / 九条" "京都府" 560 590
     node runner/add-theater.js I1 kawasaki "109シネマズ川崎" "川崎 / ラゾーナ" "神奈川県" 598 560 --chain 109
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { Kinezo } = require('./lib/kinezo');
const { K109 } = require('./lib/k109');
const { Toho } = require('./lib/toho');

var ROOT = path.join(__dirname, '..');
var argv = process.argv.slice(2);
function opt(name, def) { var i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; }
var CHAIN = String(opt('chain', 'kinezo')).toLowerCase();
var DAYS = parseInt(opt('days', '3'), 10) || 3;
var args = argv.filter(function (a, i) { return !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')); });
var [spec, key, name, area, pref, mapX, mapY] = args;
if (!spec || !key || !name) { console.error('usage: node runner/add-theater.js <spec> <key> "<名前>" "<エリア>" "<都道府県>" [mapX mapY] [--chain kinezo|109]'); process.exit(2); }
mapX = mapX || 600; mapY = mapY || 550;

function compress(nums) { nums = nums.slice().sort(function (a, b) { return a - b; }); var seg = [], s = nums[0], p = nums[0]; for (var i = 1; i <= nums.length; i++) { if (nums[i] === p + 1) { p = nums[i]; continue; } seg.push([s, p]); s = nums[i]; p = nums[i]; } return seg; }
function dateStr(d) { return new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10); }
function q(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

(async function () {
  var k = CHAIN === '109' ? new K109({ alias: spec, name: name }) : (CHAIN === 'toho' ? new Toho({ code: spec, name: name }) : new Kinezo({ theaterPath: spec }));
  var init = await k.init();
  var tid = init.theaterId;
  if (!tid) throw new Error('theaterId を取得できません: ' + spec);

  // 発売済み数日分からスクリーンごとに上映回を1つ拾う
  var byScreen = {};
  for (var d = 0; d < DAYS; d++) {
    var mv = await k.fetchSchedule(dateStr(d));
    mv.forEach(function (m) { m.shows.forEach(function (s) { var sk = String(s.screenCode || s.screen); if (s.reserveUrl && !byScreen[sk]) byScreen[sk] = s; }); });
  }
  var codes = Object.keys(byScreen).sort(function (a, b) { return (+byScreen[a].screen || 0) - (+byScreen[b].screen || 0) || (a < b ? -1 : 1); });
  if (!codes.length) throw new Error('上映回が見つかりません（発売済みの日が無い？ --days を増やす）');

  var blocks = [], total = 0, scount = 0;
  for (var i = 0; i < codes.length; i++) {
    var s = byScreen[codes[i]];
    await k.openShow(s);
    var map = await k.fetchSeatMap(); var rows = {};
    Object.keys(map).forEach(function (id) { var m = id.match(/^([A-Z]+)-?(\d+)$/); if (!m) return; (rows[m[1]] = rows[m[1]] || []).push(+m[2]); });
    var labels = Object.keys(rows).sort(); var n = Object.keys(map).length;
    if (!n) { console.log('  (skip) screen ' + codes[i] + ': 座席0'); continue; }
    total += n; scount++;
    var gw = Math.max.apply(null, [].concat.apply([], labels.map(function (r) { return rows[r]; })));
    var scNum = s.screen || codes[i];
    var scName = s.screenName || ('スクリーン' + scNum);
    var rowLines = labels.map(function (r) { return "        row('" + r + "', [" + compress(rows[r]).map(function (x) { return '[' + x[0] + ',' + x[1] + ']'; }).join(',') + '])'; });
    blocks.push('      // ' + scName + '：' + n + '席\r\n      screen(\'s' + scNum + '\', \'' + q(scName) + '\', [\r\n' + rowLines.join(',\r\n') + '\r\n      ], { gridWidth: ' + gw + ' })');
  }
  var today = dateStr(0);
  var chainId = CHAIN === '109' ? 'c109' : (CHAIN === 'toho' ? 'toho' : 'tjoy');
  var entryId = chainId + '-' + key;

  // 1) theaters.js に挿入
  var tf = path.join(ROOT, 'cinema/data/theaters.js');
  var ts = fs.readFileSync(tf, 'utf8');
  if (ts.indexOf("id: '" + entryId + "'") >= 0) { console.log('theaters.js: 既に存在 (' + entryId + ') → スキップ'); }
  else {
    var sys = CHAIN === '109'
      ? "      c109: { alias: '" + q(spec) + "', tsc: '" + q(tid) + "' },"
      : (CHAIN === 'toho'
        ? "      toho: { code: '" + q(spec) + "' },"
        : "      kinezo: { path: '" + q(spec) + "', theaterId: '" + q(tid) + "' },");
    var entry = [",", "    {", "      id: '" + entryId + "',", "      chain: '" + chainId + "',", "      name: '" + q(name) + "',",
      "      area: '" + q(area || '') + "',", "      pref: '" + q(pref || '') + "',",
      "      map: { x: " + mapX + ", y: " + mapY + " },",
      "      note: '全" + scount + "スクリーン・" + total.toLocaleString() + "席（実データ " + today + " 自動採取）。runner は --theater " + key + "。',",
      "      runnerKey: '" + q(key) + "',",
      sys,
      "      screens: [", blocks.join(',\r\n'), "      ]", "    }"].join('\r\n');
    var anchor = '\r\n    }\r\n  ];';
    var idx = ts.indexOf(anchor);
    if (idx < 0) throw new Error('theaters.js の挿入位置が見つかりません');
    ts = ts.slice(0, idx) + '\r\n    }' + entry + '\r\n  ];' + ts.slice(idx + anchor.length);
    fs.writeFileSync(tf, ts);
  }

  // 2) runner のテーブルにキー追加（TOHO は劇場コード/別名で自動解決されるので不要）
  var rf = path.join(ROOT, 'runner/reserve-hybrid.js');
  var rs = fs.readFileSync(rf, 'utf8');
  if (CHAIN === 'toho') { console.log('✓ ' + name + ' (toho ' + spec + ') key=' + key + ' : ' + scount + 'スクリーン / ' + total + '席 → theaters.js 更新（runner は toho' + spec + ' / 別名で解決）'); return; }
  var line = CHAIN === '109'
    ? "  " + key + ": { chain: '109', alias: '" + q(spec) + "', name: '" + q(name) + "' }"
    : "  " + key + ": { path: '" + q(spec) + "', id: '" + q(tid) + "', name: '" + q(name) + "' }";
  var blockRe = CHAIN === '109' ? /(var THEATERS_109 = \{\r?\n[\s\S]*?)(\r?\n\};)/ : /(var THEATERS = \{\r?\n[\s\S]*?)(\r?\n\};)/;
  if (!new RegExp('^\\s+' + key + ':', 'm').test(rs)) {
    rs = rs.replace(blockRe, function (_, body, end) { return body + ',\n' + line + end; });
    fs.writeFileSync(rf, rs);
  }
  console.log('✓ ' + name + ' (' + CHAIN + ' ' + spec + ' / id=' + tid + ') key=' + key + ' : ' + scount + 'スクリーン / ' + total + '席 → theaters.js, runner 更新');
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
