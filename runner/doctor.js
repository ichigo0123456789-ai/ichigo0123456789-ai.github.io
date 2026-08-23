#!/usr/bin/env node
/* ============================================================
   劇場ヘルスチェック（doctor）
   ------------------------------------------------------------
   各劇場で「番組表取得 → 座席画面到達 → 空席取得」が通るかを一覧表示する。
   ★ 読み取り専用。席は一切押さえない。ログインも不要（公開範囲のみ）。
   serve.js と同じ getSchedule/getSeatMap を使うので、実際のサイト表示と同じ経路。

   使い方:
     node runner/doctor.js                 … 既定の代表劇場を今日+2日でチェック
     node runner/doctor.js 2026-08-27      … 日付指定
     node runner/doctor.js --theater yokohama   … 1館だけ
     node runner/doctor.js --all           … TOHO 別名も含め全キー
   ============================================================ */
'use strict';

const { getSchedule, getSeatMap } = require('./serve');
const { allKeys } = require('./lib/venues');

function arg(name) {
  var i = process.argv.indexOf('--' + name);
  if (i < 0) return null;
  var v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pad(s, n) { s = String(s == null ? '' : s); var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2000 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); }

// 代表劇場（チェーンごとに1つ以上）。--all で TOHO 別名も全部。
var DEFAULT_KEYS = ['yokohama', 'wald9', 'kyoto', 'umeda', 'burg13', 'kawasaki', 'premium_shinjuku', 'toho_shinjuku', 'cinecitta', 'gdcs', 'shinbungeiza'];

function jstPlus(days) {
  // Date 生成に依存しないよう、環境の現在時刻から素朴に算出
  var base = Date.now() + 9 * 3600 * 1000 + days * 86400 * 1000;
  return new Date(base).toISOString().slice(0, 10);
}

(async () => {
  var posDate = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : null;
  var date = arg('date') && arg('date') !== true ? arg('date') : (posDate || jstPlus(2));
  var one = arg('theater');
  var keys = one && one !== true ? [String(one).toLowerCase()] : (arg('all') ? allKeys() : DEFAULT_KEYS);

  console.log('劇場ヘルスチェック（日付 ' + date + '）  ※読み取り専用・席は取りません\n');
  console.log(pad('劇場キー', 18) + pad('chain', 10) + pad('番組表', 14) + pad('座席図', 16) + '判定');
  console.log('-'.repeat(74));

  var okN = 0, partN = 0, ngN = 0;
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var chain = '', schedStr = '', seatStr = '', verdict = '', note = '';
    try {
      var sched = await getSchedule(key, date);
      chain = sched.chain || '';
      var movies = sched.movies || [];
      var shows = movies.reduce(function (s, m) { return s + ((m.shows && m.shows.length) || 0); }, 0);
      schedStr = movies.length + '作/' + shows + '回';
      if (!shows) {
        seatStr = '—'; verdict = '△ 番組表のみ'; note = '（発売前/上映無しの可能性）'; partN++;
      } else {
        // 座席図が取れる回を探す（先頭から時刻のある回）
        var target = null;
        for (var mi = 0; mi < movies.length && !target; mi++) {
          var m = movies[mi];
          (m.shows || []).forEach(function (sh) { if (!target && sh.time) target = { title: m.title, time: sh.time }; });
        }
        try {
          // タイトルは正規化で表記ゆれが出るため、時刻のみで照合する（座席図が取れるかの確認が目的）
          var sm = await getSeatMap(key, date, '', target.time);
          var total = (sm.seats || []).length;
          var avail = (sm.seats || []).filter(function (s) { return s.state === 'available'; }).length;
          seatStr = total + '席/空' + avail;
          verdict = total ? '✅ OK' : '△ 席数0'; if (total) okN++; else partN++;
        } catch (e2) {
          seatStr = '×'; verdict = '△ 番組表のみ'; note = '座席図: ' + short(e2.message); partN++;
        }
      }
    } catch (e) {
      chain = chain || ''; schedStr = '×'; seatStr = '—'; verdict = '✗ NG'; note = short(e.message); ngN++;
    }
    console.log(pad(key, 18) + pad(chain, 10) + pad(schedStr, 14) + pad(seatStr, 16) + verdict + (note ? '  ' + note : ''));
    await sleep(300);
  }

  console.log('-'.repeat(74));
  console.log('合計: ✅' + okN + '  △' + partN + '  ✗' + ngN + '  / ' + keys.length + '館');
  console.log('\n凡例  ✅=番組表も座席図も取得OK（自動確保の土台が動く）');
  console.log('      △=番組表は取れるが座席図まで行けない（発売前 or その劇場は座席図未対応）');
  console.log('      ✗=番組表が取れない（サイト変更/ネットワーク/未対応）');
  console.log('※ プロキシ環境（クラウド等）では許可外ドメインが ✗ になります。手元PCで実行してください。');
})().catch(function (e) { console.error('ERROR:', e.message); process.exit(1); });

function short(s) { s = String(s || ''); return s.length > 60 ? s.slice(0, 60) + '…' : s; }
