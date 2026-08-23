#!/usr/bin/env node
/* ============================================================
   KINEZO 劇場の自動追加ツール（トークン節約用・手作業ゼロ）
   ------------------------------------------------------------
   劇場パスを渡すと、実サイトから全スクリーンの座席表を採取して
   1) cinema/data/theaters.js に劇場エントリを挿入（row() 圧縮形式）
   2) runner/reserve-hybrid.js の THEATERS にキーを追加
   3) cinema/app.js の THEATER_KEYS にキーを追加
   を自動で行う。出力は要約のみ。

   使い方:
     node runner/add-theater.js <kinezoPath> <key> "<劇場名>" "<エリア>" "<都道府県>" [mapX mapY] [--days N]
   例:
     node runner/add-theater.js t-joy_kyoto kyoto "T・ジョイ京都" "京都 / 九条" "京都府" 560 590
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { Kinezo } = require('./lib/kinezo');

var ROOT = path.join(__dirname, '..');
var args = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });
var daysOpt = process.argv.indexOf('--days'); var DAYS = daysOpt > 0 ? parseInt(process.argv[daysOpt + 1], 10) : 3;
var [kpath, key, name, area, pref, mapX, mapY] = args;
if (!kpath || !key || !name) { console.error('usage: node runner/add-theater.js <kinezoPath> <key> "<名前>" "<エリア>" "<都道府県>" [mapX mapY]'); process.exit(2); }
mapX = mapX || 600; mapY = mapY || 550;

function compress(nums) { nums = nums.slice().sort(function (a, b) { return a - b; }); var seg = [], s = nums[0], p = nums[0]; for (var i = 1; i <= nums.length; i++) { if (nums[i] === p + 1) { p = nums[i]; continue; } seg.push([s, p]); s = nums[i]; p = nums[i]; } return seg; }
function dateStr(d) { return new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10); }

(async function () {
  var k = new Kinezo({ theaterPath: kpath });
  var init = await k.init();
  var tid = init.theaterId;
  if (!tid) throw new Error('theaterId を取得できません: ' + kpath);

  // 発売済み数日分からスクリーンごとに上映回を1つ拾う
  var byScreen = {};
  for (var d = 0; d < DAYS; d++) {
    var mv = await k.fetchSchedule(dateStr(d));
    mv.forEach(function (m) { m.shows.forEach(function (s) { if (s.reserveUrl && !byScreen[s.screen]) byScreen[s.screen] = s; }); });
  }
  var screens = Object.keys(byScreen).sort(function (a, b) { return +a - +b; });
  if (!screens.length) throw new Error('上映回が見つかりません（発売済みの日が無い？ --days を増やす）');

  var blocks = [], total = 0;
  for (var i = 0; i < screens.length; i++) {
    var sc = screens[i];
    await k.openShow(byScreen[sc]);
    var map = k.fetchSeatMap(); var rows = {};
    Object.keys(map).forEach(function (id) { var m = id.match(/^([A-Z]+)-?(\d+)$/); if (!m) return; (rows[m[1]] = rows[m[1]] || []).push(+m[2]); });
    var labels = Object.keys(rows).sort(); var n = Object.keys(map).length; total += n;
    var gw = Math.max.apply(null, [].concat.apply([], labels.map(function (r) { return rows[r]; })));
    var rowLines = labels.map(function (r) { return "        row('" + r + "', [" + compress(rows[r]).map(function (x) { return '[' + x[0] + ',' + x[1] + ']'; }).join(',') + '])'; });
    blocks.push('      // スクリーン' + sc + '：' + n + '席\r\n      screen(\'s' + sc + '\', \'スクリーン' + sc + '\', [\r\n' + rowLines.join(',\r\n') + '\r\n      ], { gridWidth: ' + gw + ' })');
  }
  var today = dateStr(0);

  // 1) theaters.js に挿入
  var tf = path.join(ROOT, 'cinema/data/theaters.js');
  var ts = fs.readFileSync(tf, 'utf8');
  if (ts.indexOf("id: 'tjoy-" + key + "'") >= 0) { console.log('theaters.js: 既に存在 (tjoy-' + key + ') → スキップ'); }
  else {
    var entry = [",", "    {", "      id: 'tjoy-" + key + "',", "      chain: 'tjoy',", "      name: '" + name + "',",
      "      area: '" + (area || '') + "',", "      pref: '" + (pref || '') + "',",
      "      map: { x: " + mapX + ", y: " + mapY + " },",
      "      note: '全" + screens.length + "スクリーン・" + total.toLocaleString() + "席（KINEZO 実データ " + today + " 自動採取）。runner は --theater " + key + "。',",
      "      kinezo: { path: '" + kpath + "', theaterId: '" + tid + "' },",
      "      screens: [", blocks.join(',\r\n'), "      ]", "    }"].join('\r\n');
    var anchor = '\r\n    }\r\n  ];';
    var idx = ts.indexOf(anchor);
    if (idx < 0) throw new Error('theaters.js の挿入位置が見つかりません');
    ts = ts.slice(0, idx) + '\r\n    }' + entry + '\r\n  ];' + ts.slice(idx + anchor.length);
    fs.writeFileSync(tf, ts);
  }

  // 2) runner THEATERS
  var rf = path.join(ROOT, 'runner/reserve-hybrid.js');
  var rs = fs.readFileSync(rf, 'utf8');
  if (rs.indexOf('  ' + key + ':') < 0 && rs.indexOf("\n  " + key + " ") < 0) {
    rs = rs.replace(/(var THEATERS = \{\r?\n[\s\S]*?)(\r?\n\};)/, function (_, body, end) { return body + ",\r\n  " + key + ": { path: '" + kpath + "', id: '" + tid + "', name: '" + name + "' }" + end; });
    fs.writeFileSync(rf, rs);
  }
  // 3) site THEATER_KEYS
  var af = path.join(ROOT, 'cinema/app.js');
  var as = fs.readFileSync(af, 'utf8');
  if (as.indexOf("'" + kpath + "': '" + key + "'") < 0) {
    as = as.replace(/var THEATER_KEYS = \{([^}]*)\};/, function (_, inner) { return 'var THEATER_KEYS = {' + inner.replace(/\s*$/, '') + ", '" + kpath + "': '" + key + "' };"; });
    fs.writeFileSync(af, as);
  }
  console.log('✓ ' + name + ' (' + kpath + ' / id=' + tid + ') key=' + key + ' : ' + screens.length + 'スクリーン / ' + total + '席 → theaters.js, runner THEATERS, app THEATER_KEYS 更新');
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
