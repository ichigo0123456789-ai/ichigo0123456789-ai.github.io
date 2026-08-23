/* ============================================================
   eigaland（新文芸坐ほか）アダプタ
   ------------------------------------------------------------
   予約は app.eigaland.com（Next.js SPA）。裏は綺麗な JSON API。ゲスト購入可・全席指定。
   実キャプチャ（2026-08-23）で判明したフロー：
     GET  /endUser/film/showingFilmListByCinema?cinemaId&date        → その日の作品
     GET  /endUser/film/listShowingByCinemaAndFilmAndDate?cinemaId&filmId&date → 作品の上映回(scheduleId・発売時刻)
     GET  /endUser/film/scheduleSeatPlan/{scheduleId}                → 座席表(seatStatus)＋発売時刻(webStartSale/webPreSaleTime)
     GET  /api/webShoppingCart/holdSeat?seatSid=<sid>&scheduleId=<id> → ★席を確保（トークン返却・認証不要）
     POST /api/webShoppingCart/createWebShoppingCartTransaction {scheduleId, token, clToken} → {shoppingCartId, transactionId}
     （その後 getTicketTypes → submitShoppingCart → payment。券種・決済は人間）
   引き継ぎ：localStorage に token/shoppingCartInfo/trans/cinemaId/scheduleId 等を入れて決済ブラウザで継続。
   会員ログイン（任意）：POST /api/webShoppingCart/login?brandId&email&password → clToken。未設定ならゲスト。
   共通メソッド面：init/fetchSchedule/openShow/fetchSeatMap/secure/advanceToTicket/hold/releaseHold/
                  handoffUrl/handoffInitScript/homeUrl/pageKind/metaRefreshSec/prewarm
   ============================================================ */
'use strict';
const { request, CookieJar } = require('./http');

var APP = 'https://app.eigaland.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** @param opt { cinemaId, brandId, name } 新文芸坐: cinemaId=621c87d50a861337f2dd38ec, brandId=621c83f80a861337f2dd3715 */
function Eigaland(opt) {
  opt = opt || {};
  this.cinemaId = opt.cinemaId;
  this.brandId = opt.brandId || null;
  this.name = opt.name || '新文芸坐';
  this.jar = new CookieJar();
  this.base = APP; this.chain = 'eigaland'; this.guestOk = true;
  this._clToken = null; this._member = false;
  this._schedule = null; this._hold = null; this._txn = null; this._kind = null; this._lastMap = null;
  /* eigaland は「確保したセッション」でしか確保が見えない。API で確保して別セッションの
     ブラウザに引き継ぐと「座席選択を解除」になるため、確保はブラウザ側で行う。 */
  this.browserGrab = true;
}
Eigaland.prototype.homeUrl = function () { return APP + '/'; };
Eigaland.prototype.getScheduleId = function () { return this._scheduleId; };
Eigaland.prototype.getCinemaId = function () { return this.cinemaId; };
Eigaland.prototype.bookingPageUrl = function () { return APP + '/booking?scheduleId=' + (this._scheduleId || ''); };
/* ブラウザ内で確保→取引作成を行うためのデータ（席の sid・scheduleId・cinemaId）。 */
Eigaland.prototype.grabData = function (seatIds, seatMap) {
  var m = seatMap || this._lastMap || {};
  var sids = (seatIds || []).map(function (id) { return (m[id] && m[id].sid) || id; });
  return { sids: sids, scheduleId: this._scheduleId, cinemaId: this.cinemaId };
};
Eigaland.prototype.handoffUrl = function () {
  if (this._txn) return APP + '/payment?cinemaId=' + this.cinemaId + '&token=&transactionId=' + this._txn.transactionId + '&scheduleId=' + this._scheduleId;
  return APP + '/booking?scheduleId=' + (this._scheduleId || '');
};
Eigaland.prototype.pageKind = function () { return this._kind || 'unknown'; };
Eigaland.prototype.metaRefreshSec = function () { return null; };
Eigaland.prototype.isLoggedIn = function () { return this._member; };

/* ---- 低レベル ---- */
Eigaland.prototype._get = async function (path) {
  var res = await request({ url: APP + path, jar: this.jar, headers: { Accept: 'application/json, text/plain, */*', Referer: APP + '/', 'User-Agent': UA, Cookie: 'app_version=1.3.0' } });
  var j = null; try { j = JSON.parse(res.body); } catch (e) { throw new Error('eigaland API 応答を解釈できません（' + res.status + ' ' + path.slice(0, 60) + '）'); }
  return j;
};
Eigaland.prototype._post = async function (path, body) {
  var res = await request({ method: 'POST', url: APP + path, jar: this.jar, headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json, text/plain, */*', Origin: APP, Referer: APP + '/', 'User-Agent': UA, Cookie: 'app_version=1.3.0' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  var j = null; try { j = JSON.parse(res.body); } catch (e) { j = null; }
  return { status: res.status, json: j, body: res.body };
};
function jstDate(ms) { return new Date(ms + 9 * 3600000); }
function hhmm(ms) { var d = jstDate(ms); return d.getUTCHours() + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

/* ---- 公開メソッド ---- */
Eigaland.prototype.init = async function () {
  // cinemaId は必須（新文芸坐は既定を持つ）。疎通確認だけ。
  if (!this.cinemaId) throw new Error('eigaland: cinemaId が必要です');
  try { await this._get('/endUser/film/showingDayList?cinemaId=' + this.cinemaId); } catch (e) {}
  return { theaterId: this.cinemaId };
};

/** 会員ログイン（任意）。成功で clToken を得る。失敗しても guest で続行。 */
Eigaland.prototype.login = async function (email, password) {
  if (!this.brandId) return { ok: false, reason: 'brandId 未設定のためゲストで進めます' };
  var r = await this._post('/api/webShoppingCart/login?brandId=' + this.brandId + '&email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent(password), {});
  if (r.json && r.json.success && r.json.data) {
    this._clToken = (typeof r.json.data === 'string') ? r.json.data : (r.json.data.token || r.json.data.clToken || null);
    this._member = !!this._clToken;
    return { ok: this._member, reason: this._member ? 'ログイン成功' : 'clToken を取得できませんでした' };
  }
  return { ok: false, reason: 'ログイン失敗（' + ((r.json && r.json.message) || r.status) + '）' };
};

/** その日の上映回（作品×scheduleId・発売時刻つき） */
Eigaland.prototype.fetchSchedule = async function (dateStr) {
  var self = this;
  var fl = await this._get('/endUser/film/showingFilmListByCinema?cinemaId=' + this.cinemaId + '&date=' + dateStr);
  var films = (fl.data && (fl.data.data || fl.data.filmList || fl.data)) || [];
  var movies = [];
  for (var i = 0; i < films.length; i++) {
    var fi = films[i].filmInfo || films[i]; var filmId = fi.id; if (!filmId) continue;
    var ls;
    try { ls = await this._get('/endUser/film/listShowingByCinemaAndFilmAndDate?cinemaId=' + this.cinemaId + '&filmId=' + filmId + '&date=' + dateStr); } catch (e) { continue; }
    var flist = (ls.data && ls.data.filmList) || [];
    flist.forEach(function (fe) {
      var name = (fe.filmInfo && fe.filmInfo.name) || fi.name || '';
      var mv = { title: name.replace(/\(\)$/, ''), filmCode: filmId, runtime: null, shows: [] };
      (fe.scheduleList || []).forEach(function (sc) {
        var s = sc.scheduleInfo || {}; var house = sc.houseInfo || {};
        if (!s.id) return;
        mv.shows.push({
          showId: s.id, filmCode: filmId, screen: house.name || 'SCR', screenCode: house.id || '', screenName: house.name || '',
          date: dateStr, time: hhmm(s.startTime), endTime: s.endTime ? hhmm(s.endTime) : null,
          status: s.freeSeat ? 'A' : null, freeSeat: !!s.freeSeat, allSeats: null,
          onSale: s.webPreSaleTime ? new Date(s.webPreSaleTime + 9 * 3600000).toISOString() : (s.webStartSale ? new Date(s.webStartSale + 9 * 3600000).toISOString() : null),
          generalOnSale: s.webStartSale ? new Date(s.webStartSale + 9 * 3600000).toISOString() : null,
          saleEnds: s.webEndSale ? new Date(s.webEndSale + 9 * 3600000).toISOString() : null,
          reserveUrl: 'eigaland://' + s.id,
          params: { scheduleId: s.id, filmId: filmId, filmName: mv.title, startTime: s.startTime, endTime: s.endTime }
        });
      });
      if (mv.shows.length) movies.push(mv);
    });
  }
  return movies;
};

/** 上映回を開く＝座席プランを読む（確保トークンはまだ取らない） */
Eigaland.prototype.openShow = async function (show) {
  var p = (show && show.params) || {}; var scheduleId = p.scheduleId || (show && show.showId);
  if (!scheduleId) throw new Error('show.params.scheduleId がありません');
  this._scheduleId = scheduleId; this._film = p; this._kind = null;
  var j = await this._get('/endUser/film/scheduleSeatPlan/' + scheduleId);
  if (!j.data) throw new Error('座席プランを取得できません: ' + scheduleId);
  this._plan = j.data; var si = j.data.scheduleInfo || {};
  var onSale = si.webPreSaleTime || si.webStartSale;
  if (onSale && Date.now() < onSale) { this._kind = 'notonsale'; return { ok: false, kind: 'notonsale', url: this.handoffUrl(), onSale: new Date(onSale + 9 * 3600000).toISOString() }; }
  this._kind = 'seat';
  return { ok: true, url: APP + '/booking?scheduleId=' + scheduleId, freeSeat: !!si.freeSeat };
};

/** 座席状況 → { 'A-1': {id,row,num,state,sid} }。sid はそのまま holdSeat に渡す。 */
Eigaland.prototype.fetchSeatMap = async function () {
  if (!this._plan) throw new Error('先に openShow してください');
  var rows = (this._plan.houseInfo && this._plan.houseInfo.seatingPlan && this._plan.houseInfo.seatingPlan.seats) || [];
  var map = {};
  rows.forEach(function (r) {
    (r || []).forEach(function (c) {
      if (!c || !c.sid || /^@/.test(c.sid) || !c.seatStatus) return;
      if (c.seatStatus === 'delete' || c.seatStatus === 'close') return;
      var m = String(c.sid).match(/^([A-Z]+)(\d+)$/); var id = m ? (m[1] + '-' + m[2]) : c.sid;
      map[id] = {
        id: id, row: m ? m[1] : c.sid, num: m ? +m[2] : null, sid: c.sid,
        state: c.seatStatus === 'general' ? 'available' : 'taken',
        seatType: c.seatStatus, wheelchair: false, femaleOnly: c.seatStatus === 'special'
      };
    });
  });
  this._lastMap = map; return map;
};

/** ★席を確保：GET holdSeat?seatSid&scheduleId（1席ずつ）。複数席は順に。認証不要。 */
Eigaland.prototype.secure = async function (seatIds) {
  var ids = [].concat(seatIds || []); var map = this._lastMap || {};
  var sids = [], tokens = [];
  for (var i = 0; i < ids.length; i++) {
    var s = map[ids[i]];
    if (!s) return { ok: false, code: 'noseat', reason: '席が見つかりません: ' + ids[i] };
    if (s.state !== 'available') return { ok: false, code: 'error', reason: '席が空いていません: ' + ids[i] };
    sids.push(s.sid);
  }
  for (var k = 0; k < sids.length; k++) {
    var j;
    try { j = await this._get('/api/webShoppingCart/holdSeat?seatSid=' + encodeURIComponent(sids[k]) + '&scheduleId=' + this._scheduleId); }
    catch (e) { return { ok: false, code: 'error', reason: 'holdSeat 通信エラー: ' + e.message }; }
    if (!j.success || !j.data) return { ok: false, code: 'error', reason: '席確保に失敗（' + (j.message || sids[k]) + '）' };
    tokens.push(j.data); // 最後のトークンが最新のカート
  }
  this._hold = { seatIds: ids, sids: sids, token: tokens[tokens.length - 1] };
  // 取引開始（券種・決済へ進める土台）。clToken は会員なら付与、ゲストは空。
  var tr = await this._post('/api/webShoppingCart/createWebShoppingCartTransaction', { scheduleId: this._scheduleId, token: this._hold.token, clToken: this._clToken || '', loading: true, isDefaultAlertTips: true });
  if (tr.json && tr.json.success && tr.json.data) {
    this._txn = { shoppingCartId: tr.json.data.shoppingCartId, transactionId: tr.json.data.transactionId, token: this._hold.token };
  } else {
    // 取引開始に失敗しても席は掴めているので、ブラウザ側で継続できるよう token は保持
    this._txn = null;
  }
  return { ok: true, seats: ids, token: this._hold.token, txn: this._txn };
};
Eigaland.prototype.advanceToTicket = async function () { return { ok: true, ticketUrl: this.handoffUrl() }; };
Eigaland.prototype.hold = async function (seatIds) { var s = await this.secure(seatIds); if (!s.ok) return s; var a = await this.advanceToTicket(); return Object.assign({}, s, a); };
Eigaland.prototype.releaseHold = async function () {
  if (!this._hold) return { ok: true };
  var tok = encodeURIComponent(this._hold.token || '');
  try { for (var i = 0; i < this._hold.sids.length; i++) await this._get('/api/webShoppingCart/releaseSeat?seatSid=' + encodeURIComponent(this._hold.sids[i]) + '&scheduleId=' + this._scheduleId + '&token=' + tok); } catch (e) {}
  this._hold = null; this._txn = null; return { ok: true };
};
Eigaland.prototype.cancelTransaction = async function () { return this.releaseHold(); };

/** 決済ブラウザへ引き継ぐ localStorage/sessionStorage 注入スクリプト */
Eigaland.prototype.handoffInitScript = function () {
  if (!this._hold) throw new Error('引き継ぎ状態がありません（確保前）');
  var f = this._film || {};
  var shoppingCartInfo = this._txn ? { shoppingCartId: this._txn.shoppingCartId, transactionId: this._txn.transactionId, token: this._hold.token } : { token: this._hold.token };
  var trans = this._txn ? [{ scheduleId: this._scheduleId, transactionId: this._txn.transactionId, filmId: f.filmId || '', filmName: f.filmName || '', startTime: f.startTime || 0, endTime: f.endTime || 0 }] : [];
  var ls = {
    token: this._hold.token, freeSeat: String(!!(this._plan && this._plan.scheduleInfo && this._plan.scheduleInfo.freeSeat)),
    shoppingCartInfo: JSON.stringify(shoppingCartInfo), trans: JSON.stringify(trans),
    cinemaId: this.cinemaId, scheduleId: this._scheduleId
  };
  var ss = { shopId: (this._plan && this._plan.shopId) || '', loginType: this._member ? 'cl' : 'guest' };
  return '(function(){ if (location.host !== "app.eigaland.com") return; try { var ls=' + JSON.stringify(ls) + '; for (var k in ls) localStorage.setItem(k, ls[k]); var ss=' + JSON.stringify(ss) + '; for (var k2 in ss) sessionStorage.setItem(k2, ss[k2]); } catch(e){} })();';
};

/** 発売前の先読み（座席プラン）。T0 の openShow を軽くする。 */
Eigaland.prototype.prewarm = async function (show) {
  try { await this.openShow(show); } catch (e) {}
  return { ok: true };
};

module.exports = { Eigaland };
