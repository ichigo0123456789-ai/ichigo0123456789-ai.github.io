/* ============================================================
   劇場キー → 劇場設定 → アダプタ の解決（reserve-hybrid と serve で共有）
   ------------------------------------------------------------
   --theater <key> のキー空間はチェーン横断で1つ。ここが単一の真実。
   劇場を足すときはこのファイルだけ直せばよい。
   ============================================================ */
'use strict';

const { Kinezo } = require('./kinezo');
const { K109 } = require('./k109');
const { Toho } = require('./toho');
const { Cinecitta } = require('./cinecitta');
const { Sunshine } = require('./sunshine');
const { Eigaland } = require('./eigaland');

/* KINEZO 系（T・ジョイ）。劇場パスと theaterId が違うだけで処理は共通。 */
var THEATERS = {
  yokohama: { path: 't-joy_yokohama', id: '190', name: 'T・ジョイ横浜' },
  wald9:    { path: 'shinjuku_wald9', id: '140', name: '新宿バルト9' },
  kyoto: { path: 't-joy_kyoto', id: '360', name: 'T・ジョイ京都' },
  umeda: { path: 't-joy_umeda', id: '320', name: 'T・ジョイ梅田' },
  burg13: { path: 'yokohama_burg13', id: '170', name: '横浜ブルク13' }
};

/* 109シネマズ系（別システム。lib/k109.js） */
var THEATERS_109 = {
  kawasaki:         { chain: '109', alias: 'I1', name: '109シネマズ川崎' },
  premium_shinjuku: { chain: '109', alias: 'X1', name: '109シネマズプレミアム新宿' }
};

/* TOHOシネマズ（vit）。全73館を劇場コードで指定できる（toho084 等）。主要館に別名。 */
var TOHO_ALIAS = {
  toho_shinjuku: '076', toho_hibiya: '081', toho_shibuya: '043', toho_roppongi: '009', toho_ikebukuro: '084', toho_ueno: '080',
  toho_nihonbashi: '073', toho_tachikawa: '085', toho_kawasaki: '010', toho_lalaport_yokohama: '036', toho_ebina: '007'
};
function tohoTheater(key) {
  var code = TOHO_ALIAS[key] || ((String(key).match(/^toho[_-]?(\d{3})$/) || [])[1]);
  if (!code) return null;
  var list = []; try { list = require('../data/toho-theaters.json'); } catch (e) { list = []; }
  var t = list.find(function (x) { return x.code === code; });
  return { chain: 'toho', code: code, name: t ? t.name : ('TOHOシネマズ ' + code) };
}

/* その他（cinerino 系 / eigaland） */
var THEATERS_OTHER = {
  cinecitta: { chain: 'cinecitta', project: 'cinecitta-production', theaterCode: '001', name: 'チネチッタ' },
  gdcs: { chain: 'sunshine', theaterCode: '020', slug: 'gdcs', name: 'グランドシネマサンシャイン 池袋' },
  shinbungeiza: { chain: 'eigaland', cinemaId: '621c87d50a861337f2dd38ec', brandId: '621c83f80a861337f2dd3715', name: '新文芸坐' }
};

/** キー（大文字小文字問わず）から劇場設定を返す。無ければ null。 */
function resolveTheater(key) {
  key = String(key || 'yokohama').toLowerCase();
  return THEATERS[key] || THEATERS_109[key] || THEATERS_OTHER[key] || tohoTheater(key) || null;
}

/** 劇場設定からアダプタを生成する。 */
function makeAdapter(th) {
  if (th.chain === '109') return new K109({ alias: th.alias, name: th.name });
  if (th.chain === 'toho') return new Toho({ code: th.code, name: th.name });
  if (th.chain === 'cinecitta') return new Cinecitta({ project: th.project, theaterCode: th.theaterCode, name: th.name });
  if (th.chain === 'sunshine') return new Sunshine({ theaterCode: th.theaterCode, slug: th.slug, name: th.name });
  if (th.chain === 'eigaland') return new Eigaland({ cinemaId: th.cinemaId, brandId: th.brandId, name: th.name });
  return new Kinezo({ theaterPath: th.path, theaterId: th.id });
}

/** 全劇場キーの一覧（health 応答などに使う） */
function allKeys() {
  return Object.keys(THEATERS).concat(Object.keys(THEATERS_109), Object.keys(THEATERS_OTHER), Object.keys(TOHO_ALIAS));
}

module.exports = { THEATERS, THEATERS_109, TOHO_ALIAS, THEATERS_OTHER, tohoTheater, resolveTheater, makeAdapter, allKeys };
