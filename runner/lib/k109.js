/* ============================================================
   109シネマズ 実サイトアダプタ（cinema.109cinemas.net / 旧来CGI・EUC-JP）
   ------------------------------------------------------------
   KINEZO アダプタ(kinezo.js)と同じメソッド面を持つ。runner から差し替えて使う。
     init()            劇場トップ(det.cgi)から数値サイトコード(tsc)とセッションを確立
     fetchSchedule(d)  det.cgi?tsc&ymd の実番組表（作品・時刻・シアター）
     openShow(show)    resv_shw_ppt.cgi（座席選択ページ。ログイン不要）→ crt/mit 等を確保
     fetchSeatMap()    POST resv_screen_ppt.cgi の座席フラグメントを解析（async）
     login(id,pw)      login.cgi?tsc → POST logon.cgi（CAPTCHAなし）
     secure(seatIds)   POST purchase_auth.cgi（rcmd=seat-key連結）＝席を掴む点
     advanceToTicket() purchase_auth が既に次画面なので no-op
     releaseHold()     POST resv_release_ppt.cgi
     pageKind(html,url) 到達画面の種別判定（待機列/ログイン/CAPTCHA 等）
   実サイト仕様は公開ページ解析（2026-08-23）に基づく。認証情報は引数で受け取るのみ。
   ============================================================ */
'use strict';
const { request, CookieJar } = require('./http');

var BASE = 'https://cinema.109cinemas.net';
var CGI = BASE + '/cgi-bin/pc';
var RESV = CGI + '/resv/';

function decode(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim(); }
function form(obj) { return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] == null ? '' : obj[k]); }).join('&'); }
function hidden(html, name) { var m = html.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>', 'i')); if (!m) return null; var v = m[0].match(/value="([^"]*)"/); return v ? v[1] : ''; }
function title(html) { return decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''); }

/** @param opt { alias:'I1', tsc:'1150'(任意), name:'109シネマズ川崎' } */
function K109(opt) {
  this.alias = opt.alias; this.tsc = opt.tsc || null; this.name = opt.name || '';
  this.jar = new CookieJar(); this.base = BASE; this.chain = '109';
}
K109.prototype.homeUrl = function () { return CGI + '/site/det.cgi?tsc=' + (this.tsc || this.alias); };

K109.prototype.init = async function () {
  var res = await request({ url: CGI + '/site/det.cgi?tsc=' + this.alias, jar: this.jar });
  var m = res.body.match(/det\.cgi\?tsc=(\d+)/);
  if (m) this.tsc = m[1];
  if (!this.tsc) throw new Error('109: サイトコード(tsc)を取得できません: ' + this.alias);
  return { theaterId: this.tsc };
};

K109.prototype.fetchSchedule = async function (dateStr) {
  if (!this.tsc) await this.init();
  var res = await request({ url: CGI + '/site/det.cgi?tsc=' + this.tsc + '&ymd=' + dateStr, jar: this.jar });
  return parseSchedule(res.body, dateStr);
};

/** 座席選択ページを開く（ログイン不要）。crt/mit/cc 等を保持。 */
K109.prototype.openShow = async function (show) {
  /* 席クラス別リンク（variants）があれば全部開く。席はクラスごとに別売りなので、
     座席表は和集合・確保は選んだ席のクラスのセッションで行う。 */
  var vs = (show.variants && show.variants.length) ? show.variants : [{ label: show.screenName, reserveUrl: show.reserveUrl }];
  this._variants = [];
  for (var i = 0; i < vs.length; i++) {
    var res = await request({ url: vs[i].reserveUrl, jar: this.jar, followRedirect: true, headers: { Referer: this.homeUrl() } });
    var b = res.body || '';
    this._variants.push({
      label: vs[i].label, cls: vs[i].cls || null, html: b, url: res.url,
      crt: hidden(b, 'crt'), mit: hidden(b, 'mit') || '', cc: hidden(b, 'cc'),
      pno: hidden(b, 'pno') || 'resv_shw_ppt', tsc: hidden(b, 'tsc') || this.tsc,
      limit: parseInt(hidden(b, 'hiddenlimit') || '0', 10) || null,
      ok: !!hidden(b, 'crt') && /座席選択/.test(title(b))
    });
  }
  var first = this._variants[0];
  this._seatHtml = first.html; this._seatUrl = first.url;
  this._crt = first.crt; this._mit = first.mit; this._cc = first.cc; this._pno = first.pno; this._formTsc = first.tsc; this._limit = first.limit;
  var ok = this._variants.some(function (v) { return v.ok; });
  return { ok: ok, url: first.url, scheduleId: show.showId, limit: first.limit, variants: this._variants.length };
};

/** 座席表（AJAXフラグメント）。{ 'A-3': { state, typeSeat, key } } */
K109.prototype.fetchSeatMap = async function () {
  if (!this._variants || !this._variants.length) throw new Error('先に openShow() を呼んでください');
  var merged = {};
  for (var i = 0; i < this._variants.length; i++) {
    var v = this._variants[i];
    if (!v.crt) continue;
    var res = await request({
      method: 'POST', url: RESV + 'resv_screen_ppt.cgi', jar: this.jar,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: v.url },
      body: form({ crt: v.crt, mit: v.mit, seat_readonly: 0 })
    });
    var part = parseSeatMap(res.body || '');
    Object.keys(part).forEach(function (id) {
      var s = part[id]; s.variant = i; s.cls = v.cls;
      /* 同じ席が複数クラスに出たら「空席として出ている方」を優先 */
      if (!merged[id] || (merged[id].state !== 'available' && s.state === 'available')) merged[id] = s;
    });
  }
  this._lastMap = merged;
  return merged;
};

K109.prototype.login = async function (id, pw) {
  if (!id || !pw) throw new Error('IDとパスワードが必要です');
  if (!this.tsc) await this.init();
  var page = await request({ url: CGI + '/login.cgi?tsc=' + this.tsc, jar: this.jar });
  if (/recaptcha|hcaptcha/i.test(page.body)) return { ok: false, reason: 'CAPTCHAが出現。自動ログインを中止し人間に引き継ぎます' };
  var tscF = hidden(page.body, 'tsc') || this.tsc;
  var res = await request({
    method: 'POST', url: CGI + '/logon.cgi', jar: this.jar, followRedirect: true,
    headers: { Referer: CGI + '/login.cgi?tsc=' + this.tsc, Origin: BASE },
    body: form({ tsc: tscF, id: id, pw: pw })
  });
  var b = res.body || '';
  if (/name="pw"/.test(b)) {
    var err = (b.replace(/<[^>]+>/g, ' ').match(/(IDまたはパスワード[^。]{0,40}|ログインできません[^。]{0,40}|正しく[^。]{0,40})/) || [])[1];
    return { ok: false, reason: 'ログイン失敗' + (err ? '：' + err.trim() : '（ID/パスワードをご確認ください）') };
  }
  var ok = await this.isLoggedIn();
  return { ok: ok, reason: ok ? 'ログイン成功' : 'ログイン状態を確認できませんでした' };
};

K109.prototype.isLoggedIn = async function () {
  var res = await request({ url: this.homeUrl(), jar: this.jar });
  return /logout\.cgi|ログアウト/.test(res.body || '');
};

/** 席を掴む：purchase_auth.cgi に rcmd(seat-key を _ 連結) を POST。到達画面で成否判定。 */
K109.prototype.secure = async function (seatIds) {
  if (!this._crt) throw new Error('先に openShow() を呼んでください');
  var map = this._lastMap || await this.fetchSeatMap();
  var keys = [], vi = null;
  for (var i = 0; i < seatIds.length; i++) {
    var s = map[seatIds[i]];
    if (!s) return { ok: false, code: 'noseat', reason: '席が見つかりません: ' + seatIds[i] };
    if (s.state !== 'available') return { ok: false, code: 'error', reason: '席が空いていません: ' + seatIds[i] };
    if (vi === null) vi = s.variant || 0;
    else if ((s.variant || 0) !== vi) return { ok: false, code: 'mixed', reason: '席クラス（' + (this._variants[vi].label) + ' と ' + (this._variants[s.variant || 0].label) + '）をまたいで一度に確保はできません。同じクラスの席で指定してください' };
    keys.push(s.key);
  }
  var V = this._variants[vi || 0];
  if (V.limit && keys.length > V.limit) return { ok: false, code: 'limit', reason: '一度に選べる席数(' + V.limit + ')を超えています' };
  this._seatUrl = V.url; this._crt = V.crt; this._mit = V.mit; this._cc = V.cc;
  var res = await request({
    method: 'POST', url: RESV + 'purchase_auth.cgi', jar: this.jar, followRedirect: true,
    headers: { Referer: V.url, Origin: BASE },
    body: form({ mit: V.mit, crt: V.crt, pno: V.pno, tsc: V.tsc, cc: V.cc, hiddenlimit: V.limit || '', rcmd: keys.join('_'), selectCnt: keys.length })
  });
  var b = res.body || '', t = title(b), text = b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  this._ticketUrl = res.url; this._ticketHtml = b;
  if (/name="pw"/.test(b) || /\/login\.cgi/.test(res.url)) return { ok: false, code: 'login', reason: 'ログインが必要です（purchase_auth でログイン画面）' };
  if (/recaptcha|hcaptcha/i.test(b)) return { ok: false, code: 'captcha', reason: 'CAPTCHA/確認画面。停止して人間に引き継ぎます' };
  if (/(既に|すでに).{0,12}(選択|購入|予約)|他のお客様|選択できません|ご希望の座席は/.test(text)) return { ok: false, code: 'error', reason: '席が既に埋まりました: ' + (text.match(/.{0,20}(既に|すでに|他のお客様|選択できません).{0,30}/) || [''])[0].trim() };
  if (/座席選択/.test(t) && /エラー|正しく行われ/.test(text)) return { ok: false, code: 'error', reason: '座席ページに戻されました: ' + (text.match(/.{0,60}(エラー|正しく行われ).{0,40}/) || [''])[0].trim() };
  if (/券種|チケット|購入|お支払|決済|鑑賞券|料金/.test(t + ' ' + text.slice(0, 800))) return { ok: true, code: 'done', reason: '席を掴みました（' + t + '）', ticketUrl: res.url };
  return { ok: false, code: 'unknown', reason: '想定外の画面（' + t + '）。安全のため停止' };
};

K109.prototype.advanceToTicket = async function () { return { ok: true, atTicket: !!this._ticketUrl, ticketUrl: this._ticketUrl }; };
K109.prototype.handoffUrl = function () { return this._ticketUrl || this._seatUrl; };
K109.prototype.hold = async function (ids) { var s = await this.secure(ids); if (!s.ok) return s; return { ok: true, code: 'done', atTicket: true, ticketUrl: this._ticketUrl, reason: s.reason }; };

K109.prototype.releaseHold = async function () {
  try {
    var vs = this._variants || [];
    for (var i = 0; i < vs.length; i++) {
      if (!vs[i].crt) continue;
      await request({ method: 'POST', url: RESV + 'resv_release_ppt.cgi', jar: this.jar, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: vs[i].url }, body: form({ crt: vs[i].crt, mit: vs[i].mit }) });
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
};

K109.prototype.pageKind = function (html, url) {
  html = html || ''; url = url || ''; var t = title(html);
  if (/座席選択/.test(t) && /name="crt"/.test(html)) return 'seat';
  if (/g-recaptcha|hcaptcha|recaptcha|data-sitekey/i.test(html)) return 'captcha';
  if (/しばらくお待ち|順番にご案内|順番待ち|アクセスが集中|混雑して|大変混み合|waiting[\s-]?room/i.test(html)) return 'waiting';
  if (/name="pw"/.test(html) || /\/login\.cgi/.test(url)) return 'login';
  if (/販売期間外|発売前|販売しておりません|受付時間外|お取り扱い時間外|時間外です|販売対象外/.test(html)) return 'notonsale';
  return 'unknown';
};
K109.prototype.metaRefreshSec = function (html) { var m = (html || '').match(/http-equiv=["']?refresh["']?[^>]*content=["']?\s*(\d+)/i); return m ? parseInt(m[1], 10) : null; };

/* ---- パーサ ------------------------------------------------------- */
function parseSchedule(html, dateStr) {
  var movies = {}; var seen = {};
  var re = /<a\s+href="(https?:\/\/cinema\.109cinemas\.net\/cgi-bin\/pc\/resv\/resv_shw_ppt\.cgi\?[^"]*)"[^>]*class="([^"]*)"/g, m;
  while ((m = re.exec(html)) !== null) {
    var href = decode(m[1]); var q = {};
    href.replace(/[?&]([a-z]+)=([^&]*)/g, function (_, k, v) { q[k] = v; return ''; });
    var key = q.ttc + '/' + q.tssc; if (seen[key]) continue; seen[key] = true;
    var before = html.slice(0, m.index), after = html.slice(m.index, m.index + 500);
    var tM = before.match(/content_ja"[^>]*>\s*<h2 class="work_name1"[^>]*>([^<]+)<\/h2>(?![\s\S]*content_ja"[^>]*>\s*<h2 class="work_name1"[^>]*>)/);
    var ti = tM ? decode(tM[1]) : '(不明)';
    var scM = before.match(/<h3 class="content_ja"[^>]*>([^<]+)<\/h3>(?![\s\S]*<h3 class="content_ja"[^>]*>)/);
    var rtM = before.match(/com_screening_time1">(\d+)分(?![\s\S]*com_screening_time1">)/);
    var timeM = after.match(/class="time1"[^>]*>\s*(\d{1,2}:\d{2})\s*<span[^>]*>\s*[～〜~\-]?\s*(\d{1,2}:\d{2})/);
    var st = (m[2].match(/status(\d)/) || [])[1] || null;
    if (!movies[ti]) movies[ti] = { title: ti, filmCode: null, runtime: rtM ? parseInt(rtM[1], 10) : null, dolby: /Dolby/i.test(ti), shows: [] };
    var screenName = scM ? decode(scM[1]) : '';
    var screenNum = (screenName.match(/\d+/) || [q.tssc])[0];
    /* 席クラス別リンク（プレミアム新宿: "THEATER1 CLASS S" / "CLASS A"）。同じ上映回の variant として束ねる。 */
    var lab = decode(((after.match(/class="screen1"[^>]*>([^<]*)</) || [])[1] || ''));
    var variant = { label: lab || screenName, cls: (lab.match(/CLASS\s*([A-Z])/i) || [])[1] || null, tssc: q.tssc, cs: q.cs, reserveUrl: href };
    var t0 = timeM ? timeM[1] : null;
    var same = movies[ti].shows.find(function (x) { return x.time === t0 && x.screenName === screenName; });
    if (same) { same.variants.push(variant); continue; }
    movies[ti].shows.push({ showId: q.ttc, filmCode: null, screen: screenNum, screenCode: screenNum, screenName: screenName,
      date: q.ymd || dateStr, time: t0, endTime: timeM ? timeM[2] : null, status: st, reserveUrl: href, variants: [variant] });
  }
  return Object.keys(movies).map(function (t) { return movies[t]; });
}

/** <input class="seat" type="checkbox" value="A -003" data-universal="" data-seat-key="1-3" [disabled]/> */
function parseSeatMap(html) {
  var seats = {}; var re = /<input[^>]*class="[^"]*\bseat\b[^"]*"[^>]*>/g, m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var v = (tag.match(/value="([A-Z]+)\s*-\s*0*(\d+)"/) || []); if (!v[1]) continue;
    var id = v[1] + '-' + v[2];
    var key = (tag.match(/data-seat-key="([^"]*)"/) || [])[1] || null;
    var uni = (tag.match(/data-universal="([^"]*)"/) || [])[1] || '';
    var cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    var disabled = /\bdisabled\b/.test(tag);
    var type = uni ? 'wheelchair' : (/executive/.test(cls) ? 'executive' : (/premium|premier/.test(cls) ? 'premium' : '1'));
    seats[id] = { state: disabled ? 'taken' : 'available', typeSeat: type, key: key };
  }
  /* 売切・販売対象外の席は <input> ではなく <i class="... seat_none" title="A -001"> で描かれる
     （プレミアム新宿で顕著）。レイアウト採取と「埋まっている席」の把握のために拾う。 */
  var re2 = /<i[^>]*class="[^"]*seat_none[^"]*"[^>]*>/g;
  while ((m = re2.exec(html)) !== null) {
    var t2 = m[0];
    var v2 = (t2.match(/title="([A-Z]+)\s*-\s*0*(\d+)"/) || []); if (!v2[1]) continue;
    var id2 = v2[1] + '-' + v2[2];
    if (seats[id2]) continue;
    var uni2 = /universal/.test((t2.match(/class="([^"]*)"/) || [])[1] || '');
    seats[id2] = { state: 'taken', typeSeat: uni2 ? 'wheelchair' : '1', key: null };
  }
  return seats;
}

module.exports = { K109, parseSchedule, parseSeatMap };
