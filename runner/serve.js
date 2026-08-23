#!/usr/bin/env node
/* ============================================================
   ローカル番組表サーバ（サイト⇔手元runnerの読み取り専用ブリッジ）
   ------------------------------------------------------------
   静的サイト（GitHub Pages）は各映画館の実番組表を安定して取得できない（CORS）。
   そこで手元PCでこのサーバを立て、サイトが 127.0.0.1 に問い合わせて
   実際の上映回リストを表示する。読み取り専用（予約はしない）。

   起動:  node runner/serve.js          （既定ポート 8790）
          node runner/serve.js --port 8790
   確認:  http://127.0.0.1:8790/health
   番組:  http://127.0.0.1:8790/schedule?theater=shinbungeiza&date=2026-08-25

   ・127.0.0.1 のみで待受（外部からは繋がらない）
   ・CORS はサイトの origin（*.github.io）と localhost だけ許可
   ・認証情報は使わない（番組表はゲストで取得できる）。予約は従来どおり
     reserve-hybrid.js（人が明示的に実行）。
   ============================================================ */
'use strict';
const http = require('http');
const { resolveTheater, makeAdapter, allKeys } = require('./lib/venues');

function argv(name, def) {
  var i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PORT = parseInt(process.env.SCHEDULE_PORT || argv('port', '8790'), 10) || 8790;

/* CORS: 許可する web origin。GitHub Pages（*.github.io）と手元の localhost だけ。 */
const ORIGIN_OK = [
  /^https:\/\/[a-z0-9-]+\.github\.io$/i,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
  /^http:\/\/\[::1\](:\d+)?$/i
];
function setCors(req, res) {
  var o = req.headers.origin || '';
  if (ORIGIN_OK.some(function (re) { return re.test(o); })) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* 仕様タグ（字幕/吹替/IMAX/Dolby/4DX/3D…）をタイトル・スクリーン名から拾う */
function deriveTags(str) {
  var s = String(str || '');
  var tags = [];
  function has(re, tag) { if (re.test(s) && tags.indexOf(tag) < 0) tags.push(tag); }
  has(/IMAX\s*レーザー\s*GT|IMAX\s*Laser\s*GT/i, 'IMAXレーザーGT');
  if (!tags.length) has(/IMAX\s*レーザー|IMAX\s*Laser/i, 'IMAXレーザー');
  if (tags.indexOf('IMAXレーザーGT') < 0 && tags.indexOf('IMAXレーザー') < 0) has(/IMAX/i, 'IMAX');
  has(/DOLBY\s*CINEMA|ドルビーシネマ/i, 'Dolby Cinema');
  has(/DOLBY\s*ATMOS|ドルビーアトモス/i, 'Dolby Atmos');
  has(/4DX/i, '4DX');
  has(/MX4D/i, 'MX4D');
  has(/ScreenX|スクリーンX/i, 'ScreenX');
  has(/TCX|グランドEXPO/i, 'TCX');
  has(/(?:^|[^0-9A-Za-z])3D(?:[^0-9A-Za-z]|$)/i, '3D');
  has(/字幕/i, '字幕');
  has(/吹替|吹き替え/i, '吹替');
  return tags;
}

/* アダプタの fetchSchedule 結果を、サイトが扱いやすい形へ正規化 */
function normalize(key, th, date, raw) {
  var movies = Array.isArray(raw) ? raw : Object.keys(raw || {}).map(function (k) { return raw[k]; });
  return {
    ok: true,
    theater: key,
    name: th.name,
    chain: th.chain,
    date: date,
    fetchedAt: new Date().toISOString(),
    movies: movies.map(function (m) {
      var titleTags = deriveTags(m.title);
      return {
        title: m.title,
        runtime: m.runtime || null,
        tags: titleTags,
        shows: (m.shows || []).map(function (s) {
          var tags = titleTags.concat(deriveTags(s.screenName)).filter(function (v, i, a) { return a.indexOf(v) === i; });
          var scName = s.screenName || (s.screen != null && s.screen !== '' ? ('スクリーン' + s.screen) : '');
          return {
            time: s.time || null,
            endTime: s.endTime || null,
            screen: s.screen != null ? String(s.screen) : null,
            screenCode: s.screenCode != null ? String(s.screenCode) : null,
            screenName: scName,
            status: s.status != null ? s.status : null,
            remaining: (s.remaining != null ? s.remaining : (s.freeSeat != null ? (s.freeSeat ? null : 0) : null)),
            allSeats: s.allSeats || null,
            tags: tags,
            showId: s.showId != null ? String(s.showId) : null
          };
        })
      };
    }).filter(function (m) { return m.shows.length; })
  };
}

/* 短期キャッシュ（同じ theater+date への連打を避ける。TTL 60秒） */
var cache = new Map();
var TTL = 60 * 1000;

async function getSchedule(key, date) {
  var ck = key + '|' + date;
  var hit = cache.get(ck);
  if (hit && (Date.now() - hit.t) < TTL) return hit.data;
  var th = resolveTheater(key);
  if (!th) { var e = new Error('unknown theater: ' + key); e.status = 400; throw e; }
  var a = makeAdapter(th);
  if (typeof a.init === 'function') { try { await a.init(); } catch (e) { /* init 失敗でも fetchSchedule を試す */ } }
  var raw = await a.fetchSchedule(date);
  var data = normalize(key, th, date, raw);
  cache.set(ck, { t: Date.now(), data: data });
  return data;
}

function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async function (req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  var u;
  try { u = new URL(req.url, 'http://127.0.0.1'); } catch (e) { sendJson(res, 400, { ok: false, error: 'bad url' }); return; }

  if (u.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'cinema-schedule', version: 1, theaters: allKeys() });
    return;
  }

  if (u.pathname === '/schedule') {
    var theater = u.searchParams.get('theater') || 'yokohama';
    var date = u.searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { sendJson(res, 400, { ok: false, error: 'date は YYYY-MM-DD で指定' }); return; }
    try {
      var data = await getSchedule(theater.toLowerCase(), date);
      sendJson(res, 200, data);
    } catch (e) {
      console.error('[schedule] ' + theater + ' ' + date + ' -> ' + e.message);
      sendJson(res, e.status || 502, { ok: false, theater: theater, date: date, error: e.message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('番組表サーバ起動: http://127.0.0.1:' + PORT + '  （Ctrl+C で停止）');
  console.log('  health   : http://127.0.0.1:' + PORT + '/health');
  console.log('  schedule : http://127.0.0.1:' + PORT + '/schedule?theater=shinbungeiza&date=2026-08-25');
  console.log('サイト（' + '予約プランナー' + '）の「日にちと作品」画面が、これを見つけて実番組表を表示します。');
});
