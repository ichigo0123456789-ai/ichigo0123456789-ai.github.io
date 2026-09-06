#!/usr/bin/env node
/* ============================================================
   クラウド採取分の劇場を cinema-auto-reserve に取り込む
   （2026-09-06 / T・ジョイPRINCE品川・T・ジョイ蘇我）
   ------------------------------------------------------------
   使い方（cinema-auto-reserve のリポジトリ直下で）:
       node <このフォルダ>/apply.js            … カレントを対象
       node <このフォルダ>/apply.js <repoPath>  … パス指定
   やること（冪等・既にあればスキップ）:
     1) cinema/data/theaters.js に 2 劇場のエントリを挿入（row() 圧縮形式・lat/lng 付き）
     2) runner/lib/venues.js の THEATERS に prince_shinagawa / soga を追加、
        TOHO_ALIAS に上大岡ほか関東 TOHO 14 館の別名を追加（PC-TODO.md 用）
     3) _sc_*.json を cinema/data に置き runner/merge-seatcoords.js で
        cinema/data/seatcoords.js にマージ（終わったら _sc_*.json は削除）
   データは tjoy.jp の実座席表（data-coords）と SCREEN バー実測。推定値は含まない。
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const HERE = __dirname;
const ROOT = path.resolve(process.argv[2] || process.cwd());
if (!fs.existsSync(path.join(ROOT, 'cinema/data/theaters.js')) || !fs.existsSync(path.join(ROOT, 'runner/lib/venues.js')))
  throw new Error('cinema-auto-reserve のリポジトリ直下で実行するか、パスを引数で渡してください: ' + ROOT);

var IDS = ['tjoy-prince_shinagawa', 'tjoy-soga'];
var SOGA_HEAD = ",\r\n    {\r\n      id: 'tjoy-soga'";

// 1) theaters.js
var tf = path.join(ROOT, 'cinema/data/theaters.js'), ts = fs.readFileSync(tf, 'utf8');
var has = function (id) { return ts.indexOf("id: '" + id + "'") >= 0; };
if (has(IDS[0]) && has(IDS[1])) console.log('theaters.js: 既に両方あり → スキップ');
else {
  var entries = fs.readFileSync(path.join(HERE, 'theaters.entries.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
  if (has(IDS[0])) entries = entries.slice(entries.indexOf(SOGA_HEAD));
  else if (has(IDS[1])) entries = entries.slice(0, entries.indexOf(SOGA_HEAD));
  var nl = ts.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  if (nl === '\n') entries = entries.replace(/\r\n/g, '\n');
  var anchor = nl + '    }' + nl + '  ];', idx = ts.indexOf(anchor);
  if (idx < 0) throw new Error('theaters.js の挿入位置（最後の劇場の閉じ）が見つかりません');
  ts = ts.slice(0, idx) + nl + '    }' + entries + nl + '  ];' + ts.slice(idx + anchor.length);
  fs.writeFileSync(tf, ts);
  console.log('theaters.js: 追加 → ' + (entries.match(/id: '([^']+)'/g) || []).join(', '));
}

// 2) venues.js
var lines = JSON.parse(fs.readFileSync(path.join(HERE, 'venues.lines.json'), 'utf8'));
var vf = path.join(ROOT, 'runner/lib/venues.js'), vs = fs.readFileSync(vf, 'utf8'), addedV = [];
Object.keys(lines).forEach(function (k) {
  if (new RegExp('^\\s+' + k + ':', 'm').test(vs)) return;
  var before = vs;
  vs = vs.replace(/(var THEATERS = \{\r?\n[\s\S]*?)(\r?\n\};)/, function (_, body, end) {
    return body + ',' + (vs.indexOf('\r\n') >= 0 ? '\r\n' : '\n') + lines[k] + end;
  });
  if (vs === before) throw new Error('venues.js の THEATERS ブロックが見つかりません');
  addedV.push(k);
});
// 2b) TOHO_ALIAS（PC-TODO.md の TOHO 各館を --theater の別名で呼べるようにする。劇場コードは runner/data/toho-theaters.json と一致）
var aliases = JSON.parse(fs.readFileSync(path.join(HERE, 'toho_alias.json'), 'utf8')), addedA = [];
Object.keys(aliases).forEach(function (k) {
  if (new RegExp('\\b' + k + ':').test(vs)) return;
  var before = vs;
  vs = vs.replace(/(var TOHO_ALIAS = \{[\s\S]*?)(\r?\n\};)/, function (_, body, end) {
    return body + ',' + (vs.indexOf('\r\n') >= 0 ? '\r\n' : '\n') + '  ' + k + ": '" + aliases[k] + "'" + end;
  });
  if (vs === before) throw new Error('venues.js の TOHO_ALIAS ブロックが見つかりません');
  addedA.push(k);
});
if (addedV.length || addedA.length) { fs.writeFileSync(vf, vs); console.log('venues.js: 追加 → ' + addedV.concat(addedA).join(', ')); }
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
