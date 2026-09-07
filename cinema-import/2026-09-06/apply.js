#!/usr/bin/env node
/* ============================================================
   クラウド採取分の劇場を cinema-auto-reserve に取り込む
   （2026-09-06/07 / 関東 17 館: KINEZO 2・TOHO 10・109 5）
   ------------------------------------------------------------
   使い方（cinema-auto-reserve のリポジトリ直下で）:
       node <このフォルダ>/apply.js            … カレントを対象
       node <このフォルダ>/apply.js <repoPath>  … パス指定
   やること（冪等・既にあればスキップ）:
     0) runner/lib/toho.js に建屋別 site_cd 修正（patches/toho-site-cd.js）
     1) cinema/data/theaters.js に劇場エントリを挿入（row() 圧縮形式・lat/lng 付き）
     2) runner/lib/venues.js の THEATERS / THEATERS_109 にキー追加、TOHO_ALIAS に関東 TOHO の別名を追加
     3) _sc_*.json を cinema/data に置き runner/merge-seatcoords.js で
        cinema/data/seatcoords.js にマージ（終わったら _sc_*.json は削除）
   データは各サイトの実座席表から採取。推定値は含まない。詳細は README.md。
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const HERE = __dirname;
const ROOT = path.resolve(process.argv[2] || process.cwd());
if (!fs.existsSync(path.join(ROOT, 'cinema/data/theaters.js')) || !fs.existsSync(path.join(ROOT, 'runner/lib/venues.js')))
  throw new Error('cinema-auto-reserve のリポジトリ直下で実行するか、パスを引数で渡してください: ' + ROOT);

// 0) runner/lib/toho.js: 複数建屋の劇場（錦糸町 楽天地）向けの site_cd 修正（冪等）
var pr = cp.spawnSync(process.execPath, [path.join(HERE, 'patches/toho-site-cd.js'), ROOT], { stdio: 'inherit' });
if (pr.status === 2) console.log('  → toho.js は手動修正が必要です（上のメッセージ参照）。他の取り込みは続行します');

// theaters.entries.txt は ",\r\n    {\r\n      id: '…'" で始まるエントリの連結。id ごとに分割して未登録分だけ挿入する
var ALL = fs.readFileSync(path.join(HERE, 'theaters.entries.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
var chunks = ALL.split(/(?=,\r\n    \{\r\n      id: ')/).filter(Boolean);
var IDS = chunks.map(function (c) { return (c.match(/id: '([^']+)'/) || [])[1]; });

// 1) theaters.js
var tf = path.join(ROOT, 'cinema/data/theaters.js'), ts = fs.readFileSync(tf, 'utf8');
var missing = chunks.filter(function (c, i) { return ts.indexOf("id: '" + IDS[i] + "'") < 0; });
if (!missing.length) console.log('theaters.js: ' + IDS.length + ' 劇場すべて既にあり → スキップ');
else {
  var entries = missing.join('');
  var nl = ts.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  if (nl === '\n') entries = entries.replace(/\r\n/g, '\n');
  var anchor = nl + '    }' + nl + '  ];', idx = ts.indexOf(anchor);
  if (idx < 0) throw new Error('theaters.js の挿入位置（最後の劇場の閉じ）が見つかりません');
  ts = ts.slice(0, idx) + nl + '    }' + entries + nl + '  ];' + ts.slice(idx + anchor.length);
  fs.writeFileSync(tf, ts);
  console.log('theaters.js: 追加 → ' + (entries.match(/id: '([^']+)'/g) || []).join(', '));
}

// 2) venues.js — venues.lines.json の各ブロック（THEATERS / THEATERS_109 / TOHO_ALIAS）に無いキーだけ追加
var lines = JSON.parse(fs.readFileSync(path.join(HERE, 'venues.lines.json'), 'utf8'));
if (fs.existsSync(path.join(HERE, 'toho_alias.json'))) {
  var ta = JSON.parse(fs.readFileSync(path.join(HERE, 'toho_alias.json'), 'utf8'));
  lines.TOHO_ALIAS = lines.TOHO_ALIAS || {};
  Object.keys(ta).forEach(function (k) { if (!lines.TOHO_ALIAS[k]) lines.TOHO_ALIAS[k] = '  ' + k + ": '" + ta[k] + "'"; });
}
var vf = path.join(ROOT, 'runner/lib/venues.js'), vs = fs.readFileSync(vf, 'utf8'), addedV = [];
Object.keys(lines).forEach(function (block) {
  var re = new RegExp('(var ' + block + ' = \\{[\\s\\S]*?)(\\r?\\n\\};)');
  Object.keys(lines[block]).forEach(function (k) {
    if (new RegExp('^\\s+' + k + ':', 'm').test(vs) || new RegExp('[{,]\\s*' + k + ':').test(vs)) return;
    var before = vs;
    vs = vs.replace(re, function (_, body, end) { return body + ',' + (vs.indexOf('\r\n') >= 0 ? '\r\n' : '\n') + lines[block][k] + end; });
    if (vs === before) throw new Error('venues.js の ' + block + ' ブロックが見つかりません');
    addedV.push(k);
  });
});
if (addedV.length) { fs.writeFileSync(vf, vs); console.log('venues.js: 追加 → ' + addedV.join(', ')); }
else console.log('venues.js: 既にあり → スキップ');

// 3) seatcoords
var frags = fs.readdirSync(HERE).filter(function (f) { return /^_sc_.*\.json$/.test(f); });
frags.forEach(function (f) { fs.copyFileSync(path.join(HERE, f), path.join(ROOT, 'cinema/data', f)); });
var r = cp.spawnSync(process.execPath, [path.join(ROOT, 'runner/merge-seatcoords.js')].concat(frags), { stdio: 'inherit', cwd: ROOT });
frags.forEach(function (f) { try { fs.unlinkSync(path.join(ROOT, 'cinema/data', f)); } catch (e) {} });
if (r.status !== 0) throw new Error('merge-seatcoords.js 失敗');

// 検証（席ID が theaters.js と seatcoords.js で一致するか）
global.window = {};
require(path.join(ROOT, 'cinema/data/theaters.js'));
require(path.join(ROOT, 'cinema/data/seatcoords.js'));
IDS.forEach(function (id) {
  var th = window.CINEMA_DATA.theater(id), cc = window.CINEMA_SEATCOORDS[id], n = 0, miss = 0;
  if (!th) { console.log('✗ ' + id + ' が theaters.js に無い'); process.exitCode = 1; return; }
  th.screens.forEach(function (s) { s.rows.forEach(function (row) { row.seatNums.forEach(function (x) {
    n++; if (!cc || !cc[s.id] || !cc[s.id].seats[row.label + '-' + x]) miss++;
  }); }); });
  console.log((miss ? '△ ' : '✓ ') + th.name + ': ' + th.screens.length + 'スクリーン / ' + n + '席 / 座標欠け ' + miss);
  if (miss) process.exitCode = 1;
});
console.log('完了。cinema-auto-reserve 側で git add -A && git commit で確定してください。');
