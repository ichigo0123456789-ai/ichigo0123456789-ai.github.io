/* ============================================================
   TOHOシネマズ（vit）実サイトアダプタ — ゲスト（ログインなし）購入経路
   ------------------------------------------------------------
   KINEZO / 109 と同じメソッド面。runner から差し替えて使う。
     init()            劇場の番組表ページを開きセッション（Incapsula 等の Cookie）確立
     fetchSchedule(d)  api2.tohotheater.jp の番組表 JSON（TNPI3050J05）を解析
     openShow(show)    購入入口 TNPI2040J03 → 認証中継 → TNPI2040J04（ゲスト）→ TNPI2010J01（座席指定）
     fetchSeatMap()    座席指定ページの <img id="A-2" alt="A-2 空席(選択可)"> を解析
     secure(seatIds)   bookSeatIntForm → TNPI2010J02（seat_no="A-2,A-3"・kakutei_flg=1）＝席を掴む
     releaseHold()     selectSeatIntForm（seat_fnc=1）で選択解除
     pageKind(html,url) 到達画面の種別判定
   会員ログイン（TOHO-ONE / gigya SSO）は未対応。ゲストで座席指定・購入まで進める。
   実サイト仕様は公開ページ解析（2026-08-23）に基づく。
   ============================================================ */
'use strict';
const { request, CookieJar } = require('./http');

var H = 'https://hlo.tohotheater.jp';
var API = 'https://api2.tohotheater.jp';

function decode(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim(); }
function form(obj) { return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] == null ? '' : obj[k]); }).join('&'); }
function title(html) { return decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''); }
function ymd(d) { return String(d || '').replace(/-/g, ''); }
/** name 属性でフォームを探し、action と hidden 値を返す */
function formOf(html, name) {
  var re = /<form[^>]*>[\s\S]*?<\/form>/gi, m, f = null;
  while ((m = re.exec(html)) !== null) { if (m[0].indexOf('name="' + name + '"') >= 0) { f = m[0]; break; } }
  if (!f) return null;
  var h = {};
  (f.match(/<input[^>]*>/gi) || []).forEach(function (t) {
    var n = (t.match(/name="([^"]*)"/) || [])[1]; var v = (t.match(/value="([^"]*)"/) || [])[1]; var ty = (t.match(/type="([^"]*)"/) || [])[1] || '';
    if (n && !/submit|button|checkbox/i.test(ty)) h[n] = v || '';
  });
  return { action: (f.match(/action="([^"]*)"/) || [])[1] || '', hidden: h };
}

/** @param opt { code:'076', name:'TOHOシネマズ 新宿' } */
function Toho(opt) {
  this.code = String(opt.code); this.name = opt.name || ('TOHOシネマズ ' + this.code);
  this.jar = new CookieJar(); this.base = H; this.chain = 'toho'; this.guestOk = true;
}
Toho.prototype.homeUrl = function () { return H + '/net/schedule/' + this.code + '/TNPI2000J01.do'; };

Toho.prototype.init = async function () {
  await request({ url: this.homeUrl(), jar: this.jar });
  return { theaterId: this.code };
};

/** 番組表（JSON API）。複数建屋（なんば本館/別館 等）はまとめて返す。 */
Toho.prototype.fetchSchedule = async function (dateStr) {
  var url = API + '/api/schedule/v2/schedule/' + this.code + '/TNPI3050J05?__type__=html&vg_cd=' + this.code +
            '&show_day=' + ymd(dateStr) + '&isMember=&enter_kbn=&_dc=' + Math.floor(Date.now() / 1000);
  var res = await request({ url: url, jar: this.jar, headers: { Referer: this.homeUrl(), Origin: H, Accept: 'application/json, text/javascript, */*; q=0.01' } });
  var j; try { j = JSON.parse(res.body || ''); } catch (e) { throw new Error('TOHO 番組表APIの応答を解釈できません（' + (res.status) + '）'); }
  return parseSchedule(j, dateStr, this.code);
};

/** 購入入口 → 認証中継 → ゲスト → 座席指定。 */
Toho.prototype.openShow = async function (show) {
  var p = show.params;
  if (!p) throw new Error('show.params がありません（fetchSchedule の結果を渡してください）');
  var ref = this.homeUrl();
  var r1 = await request({ method: 'POST', url: H + '/net/ticket/' + this.code + '/TNPI2040J03.do', jar: this.jar, followRedirect: true,
    headers: { Referer: ref, Origin: H }, body: form({ site_cd: this.code, jyoei_date: ymd(p.date), gekijyo_cd: p.theaterCd, screen_cd: p.screenCd, sakuhin_cd: p.sakuhinCd, pf_no: p.pfNo, fnc: '1', pageid: '2000J01', enter_kbn: '' }) });
  var b1 = r1.body || '';
  // エラー（存在しない上映・販売期間外など）はここで判る
  if (/エラーが発生/.test(title(b1))) { this._seatHtml = b1; this._seatUrl = r1.url; return { ok: false, url: r1.url, reason: (b1.replace(/<[^>]+>/g, ' ').match(/\(ERR-\d+\)|指定された[^。]{0,40}|販売[^。]{0,40}/) || [''])[0] }; }
  // 認証中継（ログイン状態を JS で判定して J05/J04 へ）→ ゲストは J04
  var r2 = await request({ method: 'POST', url: H + '/net/ticket/' + this.code + '/TNPI2040J04.do', jar: this.jar, followRedirect: true,
    headers: { Referer: r1.url, Origin: H }, body: form({ enter_kbn: '' }) });
  var b2 = r2.body || '';
  var f = formOf(b2, 'selectSeatIntForm');
  if (!f) { this._seatHtml = b2; this._seatUrl = r2.url; return { ok: false, url: r2.url, reason: 'ゲスト購入の導線が見つかりません（' + title(b2) + '）' }; }
  var r3 = await request({ method: 'POST', url: /^https?:/.test(f.action) ? f.action : H + f.action, jar: this.jar, followRedirect: true,
    headers: { Referer: r2.url, Origin: H }, body: form(f.hidden) });
  var b3 = r3.body || '';
  this._seatHtml = b3; this._seatUrl = r3.url;
  this._book = formOf(b3, 'bookSeatIntForm');
  this._select = formOf(b3, 'selectSeatIntForm');
  var mm = b3.match(/initMaxMaisu\((\d+)\)/); this._limit = mm ? parseInt(mm[1], 10) : 6;
  var ok = /座席指定/.test(title(b3)) && !!this._book;
  return { ok: ok, url: r3.url, scheduleId: p.pfNo, limit: this._limit };
};

/** 座席表。{ 'A-2': { state, typeSeat } }。<img id="A-2" alt="A-2 空席(選択可)" ...> */
Toho.prototype.fetchSeatMap = function () {
  if (!this._seatHtml) throw new Error('先に openShow() を呼んでください');
  this._lastMap = parseSeatMap(this._seatHtml);
  return this._lastMap;
};

Toho.prototype.login = async function () {
  return { ok: false, reason: 'TOHO の会員ログイン（TOHO-ONE / SSO）は未対応です。ゲスト（ログインせずに購入）で進めます' };
};
Toho.prototype.isLoggedIn = async function () { return false; };

/** 席を掴む：bookSeatIntForm → TNPI2010J02（seat_no="A-2,A-3", kakutei_flg=1） */
Toho.prototype.secure = async function (seatIds) {
  if (!this._book) throw new Error('先に openShow() を呼んでください');
  var map = this._lastMap || this.fetchSeatMap();
  for (var i = 0; i < seatIds.length; i++) {
    var s = map[seatIds[i]];
    if (!s) return { ok: false, code: 'noseat', reason: '席が見つかりません: ' + seatIds[i] };
    if (s.state !== 'available') return { ok: false, code: 'error', reason: '席が空いていません: ' + seatIds[i] };
  }
  if (this._limit && seatIds.length > this._limit) return { ok: false, code: 'limit', reason: '一度に選べる席数(' + this._limit + ')を超えています' };
  var sorted = seatIds.slice().sort(function (a, b) { var pa = a.split('-'), pb = b.split('-'); return pa[0] === pb[0] ? (+pa[1] - +pb[1]) : (pa[0] < pb[0] ? -1 : 1); });
  var body = Object.assign({}, this._book.hidden, { seat_no: sorted.join(','), kakutei_flg: '1' });
  var res = await request({ method: 'POST', url: /^https?:/.test(this._book.action) ? this._book.action : H + this._book.action, jar: this.jar, followRedirect: true,
    headers: { Referer: this._seatUrl, Origin: H }, body: form(body) });
  var b = res.body || '', t = title(b), text = b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  this._ticketUrl = res.url; this._ticketHtml = b;
  if (/recaptcha|hcaptcha/i.test(b)) return { ok: false, code: 'captcha', reason: 'CAPTCHA/確認画面。停止して人間に引き継ぎます' };
  if (/エラーが発生/.test(t)) return { ok: false, code: 'error', reason: 'エラー: ' + (text.match(/.{0,60}\(ERR-\d+\)/) || [text.slice(0, 80)])[0].trim() };
  if (/座席指定/.test(t) && /(既に|すでに).{0,12}(選択|購入)|選択できません|他のお客様|お取りできません/.test(text)) return { ok: false, code: 'error', reason: '席が既に埋まりました: ' + (text.match(/.{0,20}(既に|すでに|他のお客様|選択できません|お取りできません).{0,30}/) || [''])[0].trim() };
  if (/座席指定/.test(t)) return { ok: false, code: 'error', reason: '座席指定ページに戻されました（席が取れていません）' };
  return { ok: true, code: 'done', reason: '席を掴みました（' + t + '）', ticketUrl: res.url };
};

Toho.prototype.advanceToTicket = async function () { return { ok: true, atTicket: !!this._ticketUrl, ticketUrl: this._ticketUrl }; };
Toho.prototype.handoffUrl = function () { return this._ticketUrl || this._seatUrl; };
Toho.prototype.hold = async function (ids) { var s = await this.secure(ids); if (!s.ok) return s; return { ok: true, code: 'done', atTicket: true, ticketUrl: this._ticketUrl, reason: s.reason }; };

Toho.prototype.releaseHold = async function () {
  try {
    if (!this._select) return { ok: false, reason: '解除フォームなし' };
    await request({ method: 'POST', url: /^https?:/.test(this._select.action) ? this._select.action : H + this._select.action, jar: this.jar,
      headers: { Referer: this._seatUrl, Origin: H }, body: form(Object.assign({}, this._select.hidden, { seat_fnc: '1' })) });
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
};

Toho.prototype.pageKind = function (html, url) {
  html = html || ''; url = url || ''; var t = title(html);
  if (/座席指定/.test(t) && /bookSeatIntForm/.test(html)) return 'seat';
  if (/g-recaptcha|hcaptcha|recaptcha|data-sitekey/i.test(html)) return 'captcha';
  if (/順番待ち|順番にご案内|アクセスが集中|混雑して|大変混み合|waiting[\s-]?room|只今大変混み合/i.test(html)) return 'waiting';
  if (/TNPI2040J05|type="password"|ログインが必要/.test(html + url)) return 'login';
  if (/販売期間外|発売前|販売しておりません|受付時間外|指定された上映情報が存在しません|販売対象外/.test(html)) return 'notonsale';
  return 'unknown';
};
Toho.prototype.metaRefreshSec = function (html) { var m = (html || '').match(/http-equiv=["']?refresh["']?[^>]*content=["']?\s*(\d+)/i); return m ? parseInt(m[1], 10) : null; };

/* ---- パーサ ------------------------------------------------------- */
/** TNPI3050J05 の JSON → movies[]。残席: A=余裕 B=半分 C=残りわずか D=売切/販売終了 など */
function parseSchedule(j, dateStr, code) {
  var movies = {};
  var d0 = (j && j.data && j.data[0]) || {};
  var theaters = d0.list || [];
  var multi = theaters.length > 1;
  theaters.forEach(function (th) {
    (th.list || []).forEach(function (mv) {
      var ti = decode(mv.name || ''); if (!ti) return;
      if (!movies[ti]) movies[ti] = { title: ti, filmCode: mv.code, runtime: mv.hours ? parseInt(mv.hours, 10) : null, dolby: /Dolby|ドルビー/i.test(ti), shows: [] };
      (mv.list || []).forEach(function (s) {
        var sc = s.screen || {};
        var st = (s.unsoldSeatInfo || {}).unsoldSeatStatus || null;
        var screenName = decode(sc.name || sc.ename || ('スクリーン' + sc.code)) + (multi ? '（' + decode(th.name) + '）' : '');
        movies[ti].shows.push({
          showId: String(s.code), filmCode: mv.code, screen: String(parseInt(sc.code, 10) || sc.code), screenCode: sc.code, screenName: screenName,
          date: dateStr, time: s.showingStart || null, endTime: s.showingEnd || null, status: st, allSeats: sc.allSeatNum || null,
          reserveUrl: 'toho://' + code + '/' + sc.theaterCd + '/' + sc.code + '/' + mv.code + '/' + s.code,
          params: { date: dateStr, theaterCd: sc.theaterCd, screenCd: sc.code, sakuhinCd: mv.code, pfNo: String(s.code) }
        });
      });
    });
  });
  return Object.keys(movies).map(function (t) { return movies[t]; });
}

/** <img id="A-2" name="A-2" src=".../seat_1.gif" alt="A-2 空席(選択可)" onclick="seatSelect('A','2','1')"> */
function parseSeatMap(html) {
  var seats = {}; var re = /<img[^>]*id="([A-Z]{1,3})-(\d{1,3})"[^>]*>/g, m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0]; var row = m[1], num = m[2]; var id = row + '-' + num;
    var alt = (tag.match(/alt="([^"]*)"/) || [])[1] || '';
    var state = /空席/.test(alt) ? 'available' : (/購入済|選択不可|売/.test(alt) ? 'taken' : 'blocked');
    var type = /^HC/.test(row) ? 'wheelchair' : (/プレミア|premium|ボックス/i.test(alt) ? 'premium' : '1');
    seats[id] = { state: state, typeSeat: type, key: id };
  }
  return seats;
}

module.exports = { Toho, parseSchedule, parseSeatMap };
