#!/usr/bin/env node
/* ============================================================
   KINEZO 実接続の動作確認（認証不要）
   ------------------------------------------------------------
   使い方:
     node runner/probe.js                  … 今日(JST)の番組表
     node runner/probe.js 2026-08-25       … 指定日の番組表
     node runner/probe.js 2026-08-25 seats … 先頭上映回の座席状況も取得

   クラウド/プロキシ環境では CA を指定:
     NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node runner/probe.js
   ============================================================ */
'use strict';
const { Kinezo } = require('./lib/kinezo');

function jstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

(async () => {
  var date = process.argv[2] || jstToday();
  var withSeats = process.argv[3] === 'seats';
  var k = new Kinezo({ theaterPath: 't-joy_yokohama', theaterId: '190' });
  await k.init();
  console.log('T・ジョイ横浜（theaterId=' + k.theaterId + '） ' + date + ' の上映\n');

  var sched = await k.fetchSchedule(date);
  sched.forEach(function (mv) {
    console.log('■ ' + mv.title + '  (' + (mv.runtime || '?') + '分' + (mv.dolby ? ' / DOLBY CINEMA' : '') + ')');
    console.log('   ' + mv.shows.map(function (s) {
      return (s.time || '--:--') + ' ｼｱﾀｰ' + s.screen;
    }).join('  /  '));
  });

  if (withSeats) {
    var target = sched.find(function (m) { return m.shows.length; }).shows[0];
    console.log('\n── 座席状況: ' + (target.time || '') + ' ｼｱﾀｰ' + target.screen + ' ──');
    await k.openShow(target);
    var map = k.fetchSeatMap();
    var ids = Object.keys(map);
    var avail = ids.filter(function (id) { return map[id].state === 'available'; }).length;
    console.log('全' + ids.length + '席 / 空席 ' + avail + ' / 売切 ' + (ids.length - avail));
  }
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });
