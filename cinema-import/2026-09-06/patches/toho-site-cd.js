#!/usr/bin/env node
/* runner/lib/toho.js の修正: 複数建屋の劇場（錦糸町 楽天地=0821 など）は、購入入口の site_cd と
   /net/ticket/<code>/ の <code> を「その回の theaterCd の先頭3桁」にしないと
   「指定された上映情報が存在しません (ERR-1180)」になる。番組表は 029 でまとめて取れるが購入は 082。
   冪等: 既に修正済みなら何もしない。パターンが見つからなければ手動修正の案内を出す。
   使い方: node patches/toho-site-cd.js [<repoPath>]  （apply.js からも呼ばれる） */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || process.cwd());
const f = path.join(ROOT, 'runner/lib/toho.js');
let s = fs.readFileSync(f, 'utf8');
if (s.indexOf('siteOf(') >= 0) { console.log('toho.js: 修正済み → スキップ'); process.exit(0); }
const A = "  var ref = this.homeUrl();\n  var r1 = await request({ method: 'POST', url: H + '/net/ticket/' + this.code + '/TNPI2040J03.do'";
const B = "body: form({ site_cd: this.code, jyoei_date: ymd(p.date)";
const C = "  var r2 = await request({ method: 'POST', url: H + '/net/ticket/' + this.code + '/TNPI2040J04.do'";
const nl = s.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
const a = A.replace(/\n/g, nl), c = C.replace(/\n/g, nl);
if (s.indexOf(a) < 0 || s.indexOf(B) < 0 || s.indexOf(c) < 0) {
  console.log('toho.js: 想定パターンが見つかりません。手動で openShow の site_cd / URL の this.code を theaterCd 先頭3桁に変えてください');
  process.exit(2);
}
s = s.replace(a, "  var ref = this.homeUrl();" + nl +
  "  var site = siteOf(p, this.code);   // 建屋ごとの site_cd（例: 錦糸町 楽天地 theaterCd 0821 → 082）" + nl +
  "  var r1 = await request({ method: 'POST', url: H + '/net/ticket/' + site + '/TNPI2040J03.do'");
s = s.replace(B, "body: form({ site_cd: site, jyoei_date: ymd(p.date)");
s = s.replace(c, "  var r2 = await request({ method: 'POST', url: H + '/net/ticket/' + site + '/TNPI2040J04.do'");
// ヘルパを openShow 定義の直前に追加
const defIdx = s.indexOf('Toho.prototype.openShow = async function');
if (defIdx < 0) { console.log('toho.js: openShow が見つかりません'); process.exit(2); }
s = s.slice(0, defIdx) + "/** 回の theaterCd（4桁）の先頭3桁が購入サイトの site_cd。無ければ劇場コード。 */" + nl +
  "function siteOf(p, code) { return (p && /^\\d{4}$/.test(String(p.theaterCd || ''))) ? String(p.theaterCd).slice(0, 3) : code; }" + nl + s.slice(defIdx);
fs.writeFileSync(f, s);
console.log('toho.js: 建屋別 site_cd 対応を適用');
