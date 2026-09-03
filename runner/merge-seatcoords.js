#!/usr/bin/env node
/* 採取フラグメント(_sc_*.js) を cinema/data/seatcoords.js にマージする。
   使い方: node merge-seatcoords.js _sc_kawasaki.js _sc_premium.js _sc_toho.js */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'cinema', 'data');
const SC = path.join(DATA, 'seatcoords.js');

/* 既存 seatcoords.js を評価して現在のオブジェクトを得る */
global.window = {};
require(SC);
var obj = global.window.CINEMA_SEATCOORDS || {};

var added = [];
process.argv.slice(2).forEach(function (f) {
  var p = path.isAbsolute(f) ? f : path.join(DATA, f);
  var frag = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.keys(frag).forEach(function (tid) {
    obj[tid] = Object.assign(obj[tid] || {}, frag[tid]);
    added.push(tid + '(' + Object.keys(frag[tid]).length + 'scr)');
  });
});

var header = '/* ============================================================\n' +
'   座席の実座標と、各シアターの「スクリーン中心」\n' +
'   ------------------------------------------------------------\n' +
'   seats[席ID] = [x, y] … 座席の相対位置（px）。x=左右, y=前後（小さいほど前）。席IDは theaters.js と一致。\n' +
'   screenCenterX … 「スクリーン中心」として使う x（px）。\n' +
'   centerSource=screenbar : KINEZO(T・ジョイ)。座席図PNGの SCREEN バー(高さ約10px・灰)を画素解析した実測中心。\n' +
'   centerSource=extent    : 109/東宝。座席図に SCREEN バーが無いので全席の左右中心を使う。\n' +
'       ・109  … x は data-seat-key の実グリッド列（席番号がズレる列でも館内共通の物理列で正しく並ぶ）。\n' +
'       ・東宝 … x は座席番号（vit は館内共通の列番号で、全行が中央に揃う）。\n' +
'   pitchX … 1席分の間隔（px）。minX/maxX, yFront/yBack … 全席の範囲（px）。\n' +
'   映画館が公開する座席図に基づく相対位置で、実寸(m)や床の傾斜は含まない。推定値は入れていない。\n' +
'   座標があるシアターではエンジンは席番号グリッドではなくこちらを使う。\n' +
'   ============================================================ */\n';

var body = 'window.CINEMA_SEATCOORDS = ' + JSON.stringify(obj, null, 1) + ';\n';
fs.writeFileSync(SC, header + body);
console.log('merged:', added.join(', '));
console.log('theaters now:', Object.keys(obj).join(', '));
