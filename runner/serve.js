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
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveTheater, makeAdapter, allKeys } = require('./lib/venues');

/* ---- 実予約ジョブ（サイトのボタンから reserve-hybrid.js を実際に起動する）----
   127.0.0.1 のみ・手元でユーザーが押したときだけ動く。座席を確保し、決済画面(ブラウザ)を開く。 */
var jobs = {};
var jobSeq = 0;
function startReserve(pp) {
  var id = String(++jobSeq);
  var args = [path.join(__dirname, 'reserve-hybrid.js'),
    '--theater', pp.theater, '--date', pp.date, '--title', pp.title, '--time', pp.time, '--seats', pp.seats];
  if (pp.at) args.push('--at', pp.at);
  if (pp.dry) args.push('--dry');
  var job = { id: id, log: [], done: false, code: null, startedAt: Date.now(), cmd: 'node reserve-hybrid.js ' + args.slice(1).join(' ') };
  jobs[id] = job;
  function push(chunk) { String(chunk).split(/\r?\n/).forEach(function (ln) { if (ln.length) job.log.push(ln); }); if (job.log.length > 500) job.log.splice(0, job.log.length - 500); }
  var child;
  try {
    child = spawn(process.execPath, args, { cwd: __dirname, windowsHide: true });
  } catch (e) { job.done = true; job.code = -1; push('起動に失敗: ' + e.message); return id; }
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', function (e) { push('エラー: ' + e.message); });
  child.on('close', function (code) { job.done = true; job.code = code; push('（プロセス終了 code=' + code + '）'); });
  return id;
}
function readBody(req) {
  return new Promise(function (resolve) {
    var b = ''; req.on('data', function (c) { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve(null); } });
    req.on('error', function () { resolve(null); });
  });
}

/* 静的サイト（cinema/）をこのサーバ自身から配信する。
   こうすると http://127.0.0.1:8790/ で開いたサイトは API と同一オリジンになり、
   https のデプロイ版で起きる mixed-content / Private Network Access の問題が一切起きない。 */
const CINEMA_DIR = path.join(__dirname, '..', 'cinema');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json'
};
function serveStatic(req, res, pathname) {
  var rel = decodeURIComponent(pathname).replace(/^\/cinema\//, '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  var file = path.normalize(path.join(CINEMA_DIR, rel));
  if (file.indexOf(CINEMA_DIR) !== 0) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (e, buf) {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

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
  /* Private Network Access: https の公開サイト(github.io)から 127.0.0.1 への
     アクセスは、この応答が無いと最近のChrome/Braveがブロック（プリフライトが通らずハング）する。 */
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
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

/* 実座席図（レイアウト＋空席）を取得する。
   fetchSchedule で対象回を特定 → openShow（読み取り：席は押さえない）→ fetchSeatMap。 */
var seatCache = new Map();
var SEAT_TTL = 20 * 1000;

async function getSeatMap(key, date, title, time) {
  var ck = [key, date, title, time].join('|');
  var hit = seatCache.get(ck);
  if (hit && (Date.now() - hit.t) < SEAT_TTL) return hit.data;
  var th = resolveTheater(key);
  if (!th) { var e = new Error('unknown theater: ' + key); e.status = 400; throw e; }
  var a = makeAdapter(th);
  if (typeof a.init === 'function') { try { await a.init(); } catch (e) {} }
  var raw = await a.fetchSchedule(date);
  var movies = Array.isArray(raw) ? raw : Object.keys(raw || {}).map(function (k) { return raw[k]; });
  var show = null, mv = null;
  for (var i = 0; i < movies.length && !show; i++) {
    var m = movies[i];
    if (title && String(m.title).indexOf(title) < 0 && title.indexOf(m.title) < 0) continue;
    (m.shows || []).forEach(function (s) { if (!show && s.time === time) { show = s; mv = m; } });
  }
  if (!show) { var e2 = new Error('対象の上映回が見つかりません: ' + title + ' ' + time); e2.status = 404; throw e2; }
  if (typeof a.openShow !== 'function' || typeof a.fetchSeatMap !== 'function') { var e3 = new Error('この劇場は座席図の取得に未対応です'); e3.status = 501; throw e3; }
  await a.openShow(show);
  var map = await a.fetchSeatMap();
  /* アダプタによっては座席IDをオブジェクトのキーで返す（KINEZO 等: { "A-5": {state,...} }）。
     Object.values だとIDが落ちるので、キーを id として必ず保持する。 */
  var arr = Array.isArray(map) ? map : Object.keys(map || {}).map(function (k) {
    var v = map[k] || {};
    return {
      id: v.id || k, row: v.row, num: v.num, state: v.state,
      kind: v.kind, wheelchair: v.wheelchair, type: v.type, available: v.available
    };
  });
  var seats = arr.map(function (s) {
    return {
      id: s.id,
      row: s.row != null ? String(s.row) : (String(s.id).split('-')[0] || ''),
      num: s.num != null ? s.num : parseInt((String(s.id).split('-')[1] || '0'), 10),
      state: s.state || (s.available === false ? 'sold' : 'available'),
      kind: s.kind || (s.wheelchair ? 'wheelchair' : (s.type || null))
    };
  }).filter(function (s) { return s.id; });
  var rows = {};
  seats.forEach(function (s) { rows[s.row] = Math.max(rows[s.row] || 0, s.num); });
  var data = {
    ok: true, theater: key, date: date, title: mv ? mv.title : title, time: time,
    screenName: show.screenName || (show.screen != null && show.screen !== '' ? 'スクリーン' + show.screen : ''), chain: th.chain,
    cols: seats.reduce(function (mx, s) { return Math.max(mx, s.num); }, 0),
    rows: Object.keys(rows).length,
    seats: seats
  };
  seatCache.set(ck, { t: Date.now(), data: data });
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

  if (u.pathname === '/seatmap') {
    var stheater = (u.searchParams.get('theater') || 'yokohama').toLowerCase();
    var sdate = u.searchParams.get('date') || '';
    var stitle = u.searchParams.get('title') || '';
    var stime = u.searchParams.get('time') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sdate) || !/^\d{1,2}:\d{2}$/.test(stime)) { sendJson(res, 400, { ok: false, error: 'date=YYYY-MM-DD と time=HH:MM が必要' }); return; }
    try {
      var sm = await getSeatMap(stheater, sdate, stitle, stime);
      sendJson(res, 200, sm);
    } catch (e) {
      console.error('[seatmap] ' + stheater + ' ' + sdate + ' ' + stitle + ' ' + stime + ' -> ' + e.message);
      sendJson(res, e.status || 502, { ok: false, error: e.message });
    }
    return;
  }

  /* 実予約の起動（サイトのボタンから）。ローカルのみ。 */
  if (u.pathname === '/reserve' && req.method === 'POST') {
    var body = await readBody(req);
    if (!body || !body.theater || !body.date || !body.title || !body.time || !body.seats) {
      sendJson(res, 400, { ok: false, error: 'theater/date/title/time/seats が必要' }); return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !/^\d{1,2}:\d{2}$/.test(body.time)) {
      sendJson(res, 400, { ok: false, error: 'date/time の形式が不正' }); return;
    }
    var id = startReserve({
      theater: String(body.theater).toLowerCase(), date: body.date, title: String(body.title),
      time: body.time, seats: String(body.seats), at: body.at || '', dry: !!body.dry
    });
    sendJson(res, 200, { ok: true, id: id, cmd: jobs[id].cmd });
    return;
  }
  if (u.pathname === '/reserve/status' && req.method === 'GET') {
    var jid = u.searchParams.get('id');
    var job = jobs[jid];
    if (!job) { sendJson(res, 404, { ok: false, error: 'no such job' }); return; }
    sendJson(res, 200, { ok: true, id: job.id, log: job.log, done: job.done, code: job.code });
    return;
  }

  /* それ以外は静的サイト配信（同一オリジンでサイトを開ける） */
  if (req.method === 'GET') { serveStatic(req, res, u.pathname); return; }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('番組表サーバ起動: http://127.0.0.1:' + PORT + '  （Ctrl+C で停止）');
  console.log('');
  console.log('  ★ サイトはこのURLで開いてください（実番組表・実座席図が確実に動きます）:');
  console.log('      http://127.0.0.1:' + PORT + '/');
  console.log('');
  console.log('  ※ https のデプロイ版（github.io）からでも接続を試みますが、ブラウザの制限で');
  console.log('     ローカルへ繋げないことがあります。上のローカルURLなら同一オリジンで確実です。');
  console.log('  health   : http://127.0.0.1:' + PORT + '/health');
});
