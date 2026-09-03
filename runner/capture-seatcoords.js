#!/usr/bin/env node
/* ============================================================
   座席実座標の採取 → cinema/data/seatcoords.js 用フラグメント生成
   ------------------------------------------------------------
   対象チェーンの各スクリーンについて、発売中の上映回を1つ見つけ、
   予約サイトの座席指定ページから「席の実グリッド位置」を採取する。

   ・109シネマズ : data-seat-key="行-列" の「列」が館内共通の物理グリッド位置。
                   席番号(num)がズレる列(例:F/G)でも実列で正しく中央が出る。
   ・東宝(vit)   : 座席番号が館内共通の列番号（実測で全行が中央一致）。num を列として使う。

   x = 列 * PITCH, y = 行index * ROWPITCH（相対px。実寸mや傾斜は含めない）。
   screenCenterX = 全席の左右中心（extent）。座席図PNGの SCREEN バー検出は 109/東宝には無いので
   KINEZO のような screenbar 実測は行わない（正直に centerSource=extent とする）。

   使い方:
     node capture-seatcoords.js --chain c109 --days 6 --out ../cinema/data/_seatcoords_c109.js
     node capture-seatcoords.js --theater kawasaki --days 6
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { resolveTheater, makeAdapter, THEATERS_109, TOHO_ALIAS } = require('./lib/venues');

function arg(name, def) { var i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] && !/^--/.test(process.argv[i + 1]) ? process.argv[i + 1] : (i >= 0 ? true : def); }
function ymd(d) { var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2); return y + '-' + m + '-' + day; }

const PITCH = 55, ROWPITCH = 70;

/* サイト側 theaters.js（window.CINEMA_DATA）を読み、runnerKey→theaterId と screen名→screenId を得る */
/* スクリーン名の表記ゆれを吸収：末尾の（…劇場名…）を落とし、空白を正規化 */
function normName(s) { return String(s || '').replace(/[（(][^（()）]*[)）]\s*$/, '').replace(/\s+/g, ' ').trim(); }

function loadSiteData() {
  global.window = {};
  require(path.join(__dirname, '..', 'cinema', 'data', 'theaters.js'));
  var d = global.window.CINEMA_DATA || {};
  var byRunnerKey = {};
  (d.theaters || []).forEach(function (t) {
    var screensByName = {};
    (t.screens || []).forEach(function (s) { screensByName[s.name] = s; screensByName[normName(s.name)] = s; });
    byRunnerKey[t.runnerKey] = { theaterId: t.id, name: t.name, screensByName: screensByName, screens: t.screens || [] };
  });
  return byRunnerKey;
}

/* 席オブジェクト配列 → 1スクリーン分の座標エントリ */
function buildEntry(seats, screenName, capturedFrom, useCol) {
  var rows = {}; seats.forEach(function (s) { rows[s.row] = true; });
  var rowKeys = Object.keys(rows).sort();
  var rowIndex = {}; rowKeys.forEach(function (r, i) { rowIndex[r] = i; });
  var out = {}, xs = [], ys = [];
  seats.forEach(function (s) {
    var c = useCol ? (s.col != null ? s.col : s.num) : s.num;
    if (c == null) return;
    var x = c * PITCH, y = rowIndex[s.row] * ROWPITCH;
    out[s.id] = [x, y]; xs.push(x); ys.push(y);
  });
  if (!xs.length) return null;
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  var yFront = Math.min.apply(null, ys), yBack = Math.max.apply(null, ys);
  return {
    screenCenterX: (minX + maxX) / 2,
    centerSource: 'extent',
    pitchX: PITCH,
    minX: minX, maxX: maxX, yFront: yFront, yBack: yBack,
    capturedFrom: capturedFrom,
    note: useCol ? 'data-seat-key の実グリッド列' : '座席番号=館内共通の列番号',
    seats: out
  };
}

async function captureTheater(runnerKey, days, site) {
  var th = resolveTheater(runnerKey);
  if (!th) throw new Error('unknown theater ' + runnerKey);
  var useCol = th.chain === '109';
  var siteT = site[runnerKey];
  if (!siteT) { console.error('  ! theaters.js に ' + runnerKey + ' が無い'); return null; }
  var result = {}; var seen = {}; var tries = {};
  for (var off = 0; off < days; off++) {
    var d = new Date(); d.setDate(d.getDate() + off); var date = ymd(d);
    var a = makeAdapter(th);
    if (typeof a.init === 'function') { try { await a.init(); } catch (e) {} }
    var raw;
    try { raw = await a.fetchSchedule(date); } catch (e) { console.error('  ' + date + ' sched err ' + e.message); continue; }
    var movies = Array.isArray(raw) ? raw : Object.keys(raw || {}).map(function (k) { return raw[k]; });
    for (var mi = 0; mi < movies.length; mi++) {
      var m = movies[mi];
      for (var si = 0; si < (m.shows || []).length; si++) {
        var s = m.shows[si];
        var scName = s.screenName || (s.screen != null ? 'シアター' + s.screen : '');
        if (!s.showId) continue;                 // 発売中のみ（座席図が開ける）
        var sc = siteT.screensByName[scName] || siteT.screensByName[normName(scName)];
        if (!sc) continue;                        // theaters.js に無いスクリーン名はスキップ
        if (seen[sc.id]) continue;                // 各スクリーン1回でよい
        if ((tries[sc.id] = (tries[sc.id] || 0) + 1) > 4) continue; // openShow 失敗の再試行は上限4回
        var a2 = makeAdapter(th);
        if (typeof a2.init === 'function') { try { await a2.init(); } catch (e) {} }
        try {
          var raw2 = await a2.fetchSchedule(date);   // 同一セッションで開く
          var mv2 = (Array.isArray(raw2) ? raw2 : Object.keys(raw2 || {}).map(function (k) { return raw2[k]; }))
                    .find(function (x) { return x.title === m.title; });
          var sh2 = mv2 && (mv2.shows || []).find(function (x) { return x.time === s.time && (x.screenName || '') === scName; });
          if (!sh2) continue;
          var op = await a2.openShow(sh2);
          if (op && op.ok === false) { console.error('  ' + sc.id + ' openShow NG: ' + (op.reason || '')); continue; }
          var map = await a2.fetchSeatMap();
          var arr = Object.keys(map).map(function (k) { var v = map[k] || {}; var mm = String(k).match(/^([A-Z]+)-?(\d+)$/); return { id: k, row: v.row || (mm ? mm[1] : k), num: v.num != null ? v.num : (mm ? +mm[2] : null), col: v.col }; });
          var entry = buildEntry(arr, scName, date + ' ' + s.time, useCol);
          if (entry) { result[sc.id] = entry; seen[sc.id] = true; console.log('  ' + sc.id + ' ' + scName + ' : ' + Object.keys(entry.seats).length + '席 (' + date + ' ' + s.time + ')'); }
        } catch (e) { console.error('  ' + sc.id + ' err ' + e.message); }
      }
    }
    var need = siteT.screens.length, got = Object.keys(result).length;
    if (got >= need) break;
  }
  var miss = siteT.screens.filter(function (sc) { return !result[sc.id]; }).map(function (sc) { return sc.id; });
  if (miss.length) console.error('  未取得(発売中の回なし): ' + miss.join(', '));
  return { theaterId: siteT.theaterId, screens: result };
}

(async () => {
  var site = loadSiteData();
  var days = parseInt(arg('days', '7'), 10) || 7;
  var chain = arg('chain', null), only = arg('theater', null);
  var keys;
  if (only) keys = [only];
  else if (chain === 'c109') keys = Object.keys(THEATERS_109);
  else if (chain === 'toho') keys = Object.keys(TOHO_ALIAS);
  else { console.error('--chain c109|toho か --theater <key> を指定'); process.exit(1); }

  var all = {};
  for (var i = 0; i < keys.length; i++) {
    console.log('== ' + keys[i] + ' ==');
    var r = await captureTheater(keys[i], days, site);
    if (r && Object.keys(r.screens).length) all[r.theaterId] = r.screens;
  }
  var out = arg('out', null);
  var json = JSON.stringify(all, null, 1);
  if (out) { fs.writeFileSync(path.join(__dirname, out), json); console.log('\nwrote ' + out + ' (' + Object.keys(all).length + ' theaters)'); }
  else { console.log('\n===JSON==='); console.log(json); }
})().catch(function (e) { console.error('FATAL', e.stack || e.message); process.exit(1); });
