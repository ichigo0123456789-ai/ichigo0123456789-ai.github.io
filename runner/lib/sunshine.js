/* ============================================================
   シネマサンシャイン（グランドシネマサンシャイン池袋ほか）アダプタ
   ------------------------------------------------------------
   予約サイト transaction.ticket-cinemasunshine.com は cinerino(SMART THEATER)系だが、
   座席在庫は COA 連携（EventServiceByCOA）で、チネチッタとは別経路：
     transaction…/api/authorize/getCredentials            → Bearer トークン（ゲスト）
     ssktsscheduleproduction.blob…/<slug>/schedule.json  → 番組表（発売開始日時 rsv_start_day/time つき）
     cloud.sskts.smart-theater.com/projects/sskts-production/events?id[$eq]= → 上映回（coaInfo）
     transaction…/api/master/getScreens?theaterCode=      → 全スクリーンの座席レイアウト
     transaction…/api/purchase/getSeatState?…             → 空席（COA）
     transaction…/api/master/getSalesTickets?…            → 券種（確保時に仮の券種が必要）
     waiter…/passports → apis…/txn/…/PlaceOrder/start      → 取引開始
     apis…/txc/…/offers/EventServiceByCOA/accept (202) → GET …/accept/<id> をポーリングして完了
   券種変更・決済は取引状態(sessionStorage 'purchase')を実ブラウザに注入し #/purchase/ticket から人間が続ける。
   会員ログイン(member.cinemasunshine.co.jp)は未自動化＝ゲスト購入。
   ============================================================ */
'use strict';
const { request, CookieJar } = require('./http');

var F = 'https://transaction.ticket-cinemasunshine.com';
var C = 'https://cloud.sskts.smart-theater.com';
var T = 'https://apis.smart-theater.com/txn';
var X = 'https://apis.smart-theater.com/txc';
var W = 'https://waiter.smart-theater.com';
var S = 'https://ssktsscheduleproduction.blob.core.windows.net';
var P = 'sskts-production';
var APP_VERSION = '8.59.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function Sunshine(opt) {
  opt = opt || {};
  this.theaterCode = opt.theaterCode || '020';
  this.slug = opt.slug || 'gdcs';
  this.name = opt.name || 'グランドシネマサンシャイン 池袋';
  this.jar = new CookieJar();
  this.base = F; this.chain = 'sunshine'; this.guestOk = true;
  /* 座席画面の「利用規約に同意」チェックは API 経由では通らないため、runner 利用＝規約同意の上で使う */
  this.termsNote = 'シネマサンシャインの座席画面にある「利用規約に同意」チェックは runner が API で代行できません。利用規約（https://www.cinemasunshine.co.jp/）に同意のうえ使ってください。引き継いだブラウザでは券種（最初は「一般」で仮確保）を選び直して進めます。';
  this._cred = null; this._seller = null; this._config = null; this._screens = null;
  this._event = null; this._tickets = null; this._txn = null; this._auth = null; this._kind = null; this._lastMap = null;
}
Sunshine.prototype.homeUrl = function () { return F + '/'; };
Sunshine.prototype.handoffUrl = function () { return F + '/#/purchase/ticket'; };
Sunshine.prototype.pageKind = function () { return this._kind || 'unknown'; };
Sunshine.prototype.metaRefreshSec = function () { return null; };
Sunshine.prototype.isLoggedIn = function () { return false; };
Sunshine.prototype.login = async function () { return { ok: false, reason: 'シネマサンシャイン会員ログインは未対応（ゲスト購入で進めます）' }; };

/* ---- 座席コード変換（COA は全角小文字 'ａ－４'、こちらは 'A-4'） ---- */
function fromCoa(s) { s = String(s || ''); if (/車椅子/.test(s)) return 'HC-' + (s.match(/\d+/) || ['1'])[0]; return s.replace(/[Ａ-Ｚａ-ｚ０-９－]/g, function (c) { return c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).toUpperCase(); }
function toCoa(id) { return String(id).toLowerCase().replace(/[a-z0-9-]/g, function (c) { return c === '-' ? '－' : String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }); }
function hhmm4(t) { t = String(t || ''); return t.length === 4 ? (t.slice(0, 2).replace(/^0/, '') + ':' + t.slice(2)) : t; }
function ymd(d) { return String(d).replace(/-/g, ''); }
function jstIso(day8, time4) { return day8.slice(0, 4) + '-' + day8.slice(4, 6) + '-' + day8.slice(6, 8) + 'T' + time4.slice(0, 2) + ':' + time4.slice(2, 4) + ':00+09:00'; }

/* ---- 低レベル ---- */
Sunshine.prototype._token = async function () {
  if (this._cred && this._cred.expiryDate - Date.now() > 60000) return this._cred.accessToken;
  var res = await request({ method: 'POST', url: F + '/api/authorize/getCredentials', jar: this.jar,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: F, Referer: F + '/', 'User-Agent': UA }, body: '{"member":"0","refreshAccessToken":false}' });
  var j; try { j = JSON.parse(res.body); } catch (e) { throw new Error('チケットサイトのトークン取得に失敗（' + res.status + '）'); }
  var c = j && j.credentials; if (!c || !c.accessToken) throw new Error('チケットサイトのトークン取得に失敗: ' + String(res.body).slice(0, 200));
  this._cred = { accessToken: c.accessToken, expiryDate: c.expiryDate, clientId: j.clientId }; return c.accessToken;
};
Sunshine.prototype._api = async function (method, url, body, extra) {
  var tok = await this._token();
  var h = Object.assign({ Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Content-Type': 'application/json', Origin: F, Referer: F + '/', 'User-Agent': UA }, extra || {});
  var res = await request({ method: method, url: url, jar: this.jar, headers: h, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  var j = null; try { j = res.body ? JSON.parse(res.body) : null; } catch (e) { j = null; }
  return { status: res.status, json: j, body: res.body };
};
/** フロント同居の API（認証不要・JSON） */
Sunshine.prototype._front = async function (path) {
  var res = await request({ url: F + path, jar: this.jar, headers: { Accept: 'application/json, text/plain, */*', Referer: F + '/', 'User-Agent': UA } });
  var j = null; try { j = JSON.parse(res.body); } catch (e) { throw new Error('チケットサイトAPIの応答を解釈できません（' + res.status + ' ' + path.slice(0, 60) + '）'); }
  return j;
};

/* ---- 公開メソッド ---- */
Sunshine.prototype.init = async function () {
  await this._token();
  var r = await this._api('GET', C + '/projects/' + P + '/sellers?branchCode%5B%24eq%5D=' + this.theaterCode);
  this._seller = (r.json || [])[0] || null;
  if (!this._seller) throw new Error('販売者(seller)が取得できません: theaterCode=' + this.theaterCode);
  try { this._config = await this._front('/api/config?date=' + new Date().toISOString()); } catch (e) { this._config = null; }
  try { await this._layouts(); } catch (e) { /* openShow で再試行 */ }
  return { theaterId: this.theaterCode, sellerId: this._seller.id };
};
/** 全スクリーンの座席レイアウト（screenCode → {screenCode,screenName,listSeat}） */
Sunshine.prototype._layouts = async function () {
  if (this._screens) return this._screens;
  var arr = await this._front('/api/master/getScreens?theaterCode=' + this.theaterCode);
  var m = {}; (arr || []).forEach(function (s) { m[s.screenCode] = s; }); this._screens = m; return m;
};
function physNo(name) { var m = String(name || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).match(/(\d+)/); return m ? m[1] : null; }

/** 番組表（blob の schedule.json）。shows[].onSale は一般発売（rsv_start_day/time）、memberOnSale は会員先行 */
Sunshine.prototype.fetchSchedule = async function (dateStr) {
  var res = await request({ url: S + '/' + this.slug + '/schedule.json?date=' + new Date().toISOString(), jar: this.jar, headers: { Accept: 'application/json', 'User-Agent': UA } });
  var j; try { j = JSON.parse(res.body); } catch (e) { throw new Error('番組表(blob)の応答を解釈できません（' + res.status + '）'); }
  var day = (j.schedule || []).find(function (d) { return d.date === ymd(dateStr); });
  var self = this, movies = {};
  if (!day) return [];
  (day.movie || []).forEach(function (mv) {
    var ti = mv.name || mv.cname || ''; if (!ti) return;
    if (!movies[ti]) movies[ti] = { title: ti, filmCode: mv.movie_code, runtime: mv.running_time || null, shows: [] };
    (mv.screen || []).forEach(function (sc) {
      (sc.time || []).forEach(function (t) {
        var id = self.theaterCode + mv.movie_short_code + mv.movie_branch_code + day.date + sc.screen_code + t.start_time;
        var cnt = t.seat_count || {}; var rem = cnt.cnt_reserve_free, max = cnt.cnt_reserve_max;
        movies[ti].shows.push({
          showId: id, filmCode: mv.movie_code, screen: physNo(sc.name) || sc.screen_code, screenCode: sc.screen_code, layoutKey: physNo(sc.name) || sc.screen_code, screenName: sc.name,
          date: dateStr, time: hhmm4(t.start_time), endTime: hhmm4(t.end_time), status: t.is_only_window_sale === '1' ? 'W' : (rem == null ? null : (rem > 0 ? 'A' : 'X')), allSeats: max || null, remaining: rem,
          onSale: t.rsv_start_day ? jstIso(t.rsv_start_day, t.rsv_start_time || '0000') : null,
          memberOnSale: t.member_rsv_start_day ? jstIso(t.member_rsv_start_day, t.member_rsv_start_time || '0000') : null,
          reserveUrl: 'sunshine://' + id,
          params: { eventId: id, theaterCode: self.theaterCode, titleCode: mv.movie_short_code, titleBranchNum: mv.movie_branch_code, dateJouei: day.date, timeBegin: t.start_time, screenCode: sc.screen_code }
        });
      });
    });
  });
  return Object.keys(movies).map(function (t) { return movies[t]; });
};

/** 発売前の先読み（runner の事前準備で呼ばれる）：券種一覧(COA・約4秒)とレイアウトを取っておき、T0 の openShow を軽くする */
Sunshine.prototype.prewarm = async function (show) {
  var p = (show && show.params) || {}; var eventId = p.eventId || (show && show.showId); if (!eventId) return;
  var q = 'theaterCode=' + p.theaterCode + '&dateJouei=' + p.dateJouei + '&titleCode=' + p.titleCode + '&titleBranchNum=' + p.titleBranchNum + '&timeBegin=' + p.timeBegin;
  var self = this;
  await Promise.all([
    this._layouts().catch(function () {}),
    (this._ticketsFor === eventId && this._tickets) ? Promise.resolve() : this._front('/api/master/getSalesTickets?' + q + '&flgMember=0').then(function (t) { self._tickets = t || []; self._ticketsFor = eventId; }).catch(function () {})
  ]);
  return { ok: true, tickets: (this._tickets || []).length };
};

/** 上映回を開く：回の情報(coaInfo)＋券種＋レイアウト → passport → 取引開始 */
Sunshine.prototype.openShow = async function (show) {
  var p = (show && show.params) || {}; var eventId = p.eventId || (show && show.showId);
  if (!eventId) throw new Error('show.params.eventId がありません');
  this._kind = null;
  var r = await this._api('GET', C + '/projects/' + P + '/events?limit=1&page=1&typeOf=ScreeningEvent&id%5B%24eq%5D=' + eventId);
  var e = (r.json || [])[0]; if (!e) throw new Error('上映回が見つかりません: ' + eventId);
  this._event = e; var coa = e.coaInfo || {};
  if (!coa.theaterCode) { coa = { theaterCode: p.theaterCode, dateJouei: p.dateJouei, titleCode: p.titleCode, titleBranchNum: p.titleBranchNum, timeBegin: p.timeBegin, screenCode: p.screenCode }; }
  this._coa = coa;
  if (show && show.onSale && Date.now() < new Date(show.onSale).getTime()) { this._kind = 'notonsale'; return { ok: false, kind: 'notonsale', url: F + '/', onSale: show.onSale }; }
  if (e.eventStatus && e.eventStatus !== 'EventScheduled') { this._kind = 'unknown'; return { ok: false, kind: 'unknown', url: F + '/', reason: e.eventStatus }; }
  var q = 'theaterCode=' + coa.theaterCode + '&dateJouei=' + coa.dateJouei + '&titleCode=' + coa.titleCode + '&titleBranchNum=' + coa.titleBranchNum + '&timeBegin=' + coa.timeBegin;
  var self = this;
  var rs = await Promise.all([
    this._layouts(),
    (this._tickets && this._ticketsFor === eventId) ? Promise.resolve(this._tickets) : this._front('/api/master/getSalesTickets?' + q + '&flgMember=0')
  ]);
  this._tickets = rs[1] || []; this._ticketsFor = eventId;
  this._screen = rs[0][coa.screenCode] || null;
  if (this._txn && new Date(this._txn.expires).getTime() - Date.now() > 3 * 60000) { this._kind = 'seat'; return { ok: true, url: F + '/#/purchase/seat', txn: this._txn.id }; }
  var pr = await this._api('POST', W + '/projects/' + P + '/passports', { scope: 'Transaction:PlaceOrder:' + this._seller.id });
  if (pr.status === 429 || pr.status === 503) { this._kind = 'waiting'; return { ok: false, kind: 'waiting', url: F + '/', reason: 'waiter ' + pr.status }; }
  if (!pr.json || !pr.json.token) throw new Error('入場券(passport)が取れません（' + pr.status + '）: ' + String(pr.body || '').slice(0, 160));
  var st = await this._api('POST', T + '/projects/' + P + '/transactions/PlaceOrder/start', {
    agent: { identifier: [{ name: 'userAgent', value: UA }, { name: 'application:version', value: APP_VERSION }] },
    object: { passport: { token: pr.json.token } }, seller: { id: this._seller.id } });
  if (!st.json || !st.json.id) {
    if (st.status === 429 || st.status === 503) { this._kind = 'waiting'; return { ok: false, kind: 'waiting', url: F + '/', reason: 'start ' + st.status }; }
    throw new Error('取引を開始できません（' + st.status + '）: ' + String(st.body || '').slice(0, 200));
  }
  this._txn = st.json; this._auth = null; this._kind = 'seat';
  return { ok: true, url: F + '/#/purchase/seat', txn: st.json.id, expires: st.json.expires };
};

/** 空席状況（COA getSeatState）→ { 'A-4': {id,row,num,state} } */
Sunshine.prototype.fetchSeatMap = async function () {
  if (!this._coa) throw new Error('先に openShow してください');
  var coa = this._coa, map = {};
  var lay = this._screen && this._screen.listSeat || [];
  lay.forEach(function (s) { var id = fromCoa(s.seatNum); var m = id.match(/^([A-Z]+)-(\d+)$/); map[id] = { id: id, row: m ? m[1] : id, num: m ? +m[2] : null, state: 'taken', wheelchair: /^HC-/.test(id) || s.flgHc === '1', section: s.seatSection }; });
  var st = await this._front('/api/purchase/getSeatState?theaterCode=' + coa.theaterCode + '&dateJouei=' + coa.dateJouei + '&titleCode=' + coa.titleCode + '&titleBranchNum=' + coa.titleBranchNum + '&timeBegin=' + coa.timeBegin + '&screenCode=' + coa.screenCode);
  (st.listSeat || []).forEach(function (sec) {
    (sec.listFreeSeat || []).forEach(function (f) {
      var id = fromCoa(f.seatNum); var m = id.match(/^([A-Z]+)-(\d+)$/);
      if (!map[id]) map[id] = { id: id, row: m ? m[1] : id, num: m ? +m[2] : null, state: 'taken', section: sec.seatSection };
      map[id].state = 'available'; map[id].section = sec.seatSection;
    });
  });
  this._lastMap = map; return map;
};
/** add-theater 用：取引を開かずレイアウトだけ */
Sunshine.prototype.fetchSeatLayout = async function (show) {
  var lays = await this._layouts(); var sc = lays[(show.params || {}).screenCode || show.screenCode]; var map = {};
  if (!sc || /使用不可/.test(sc.screenName || '')) return map;
  (sc.listSeat || []).forEach(function (s) { var id = fromCoa(s.seatNum); if (/^HC-/.test(id)) return; var m = id.match(/^([A-Z]+)-(\d+)$/); if (!m) return; map[id] = { id: id, row: m[1], num: +m[2], state: 'available' }; });
  return map;
};

function ticketInfo(code) { return { ticketCode: code, mvtkAppPrice: 0, ticketCount: 1, addGlasses: 0, kbnEisyahousiki: '00', mvtkNum: '', mvtkKbnDenshiken: '00', mvtkKbnMaeuriken: '00', mvtkKbnKensyu: '00', mvtkSalesPrice: 0, kbnMgtk: '' }; }

/** 席を確保（EventServiceByCOA/accept → 完了までポーリング）。券種は仮に「一般」＝ブラウザで変更可 */
Sunshine.prototype.secure = async function (seatIds) {
  if (!this._txn) return { ok: false, reason: '取引が開始されていません（openShow 未実行）' };
  var self = this, ids = [].concat(seatIds || []);
  if (this._auth) { await this.releaseHold().catch(function () {}); var re = await this.openShow({ params: { eventId: this._event.id } }); if (!re.ok) return { ok: false, reason: '取引の再開始に失敗: ' + (re.kind || '') }; }
  var tk = (this._tickets || []).find(function (t) { return /一般/.test(t.ticketName || ''); }) || (this._tickets || [])[0];
  if (!tk) return { ok: false, reason: '券種が取得できません' };
  var body = { object: { event: { id: this._event.id }, acceptedOffer: ids.map(function (id) {
      var sec = (self._lastMap && self._lastMap[id] && self._lastMap[id].section) || '   ';
      return { seatSection: sec, seatNumber: toCoa(id), ticketInfo: ticketInfo(tk.ticketCode) };
    }), appliesToSurfrock: { identifier: '', serviceOutput: { typeOf: '' } } }, purpose: { id: this._txn.id, typeOf: 'PlaceOrder' } };
  var r = await this._api('POST', X + '/projects/' + P + '/offers/EventServiceByCOA/accept?purpose%5Bid%5D=' + this._txn.id, body);
  if (!(r.status === 202 || r.status === 200 || r.status === 201) || !r.json || !r.json.id) {
    var reason = (r.json && (r.json.message || (r.json.errors && r.json.errors.map(function (x) { return x.message; }).join('; ')))) || ('HTTP ' + r.status);
    return { ok: false, reason: reason, status: r.status };
  }
  var taskId = r.json.id, result = null, last = null;
  for (var i = 0; i < 80; i++) { // COA 連携は数秒かかる。最大 ~32 秒
    var g = await this._api('GET', X + '/projects/' + P + '/offers/EventServiceByCOA/accept/' + taskId + '?purpose%5Bid%5D=' + this._txn.id, null, { 'Cache-Control': 'no-cache' });
    last = g.json || {};
    if (last.actionStatus === 'CompletedActionStatus') { result = last; break; }
    if (last.actionStatus === 'FailedActionStatus' || last.actionStatus === 'CanceledActionStatus') return { ok: false, reason: '確保に失敗（' + (last.error && (last.error.message || JSON.stringify(last.error)) || last.actionStatus) + '）' };
    await new Promise(function (res) { setTimeout(res, 400); });
  }
  if (!result) return { ok: false, reason: '確保の完了待ちがタイムアウト' };
  // 2段目：受付(accept)完了 → 承認(authorize)。これが取引に紐づく実際の座席確保アクション（券種変更・決済はこの id を参照する）
  var au = await this._api('POST', X + '/projects/' + P + '/offers/EventServiceByCOA/accept/' + (result.id || taskId) + '/authorize?purpose%5Bid%5D=' + this._txn.id, { purpose: { id: this._txn.id, typeOf: 'PlaceOrder' } });
  if (!(au.status === 201 || au.status === 200) || !au.json || !au.json.id) {
    var why = (au.json && (au.json.message || JSON.stringify(au.json.error || au.json))) || ('HTTP ' + au.status);
    return { ok: false, reason: '承認(authorize)に失敗: ' + String(why).slice(0, 160), status: au.status };
  }
  this._auth = { id: au.json.id, acceptId: result.id || taskId, result: au.json.result || {}, seats: ids, ticket: tk };
  return { ok: true, seats: ids, authId: this._auth.id, tmpReserveNum: au.json.result && au.json.result.responseBody && au.json.result.responseBody.tmpReserveNum };
};
Sunshine.prototype.advanceToTicket = async function () { return { ok: true, ticketUrl: this.handoffUrl() }; };
Sunshine.prototype.hold = async function (seatIds) { var s = await this.secure(seatIds); if (!s.ok) return s; var a = await this.advanceToTicket(); return Object.assign({}, s, a); };
Sunshine.prototype.cancelTransaction = async function () {
  if (!this._txn) return { ok: true };
  var r = await this._api('PUT', T + '/projects/' + P + '/transactions/PlaceOrder/' + this._txn.id + '/cancel', {});
  if (r.status < 400) { this._txn = null; this._auth = null; }
  return { ok: r.status < 400, status: r.status };
};
Sunshine.prototype.releaseHold = async function () { if (!this._auth) return { ok: true }; return this.cancelTransaction(); };

/** 実ブラウザへ引き継ぐ sessionStorage 注入スクリプト（'purchase' / 'CONFIG' / 'user'） */
Sunshine.prototype.handoffInitScript = function () {
  if (!this._txn || !this._auth || !this._event) throw new Error('引き継ぎ状態がありません（確保前）');
  var self = this, tk = this._auth.ticket || {};
  var ticketData = Object.assign({ mvtkNum: '', ticketCode: tk.ticketCode, ticketName: tk.ticketName, mvtkAppPrice: 0, addGlasses: tk.addGlasses || 0, kbnEisyahousiki: '00', mvtkKbnDenshiken: '00', mvtkKbnMaeuriken: '00', mvtkKbnKensyu: '00', mvtkSalesPrice: 0, kbnMgtk: '', addPrice: tk.addPrice || 0, disPrice: 0, salePrice: tk.salePrice, seatNum: '', stdPrice: tk.stdPrice, ticketCount: 1, ticketNameEng: tk.ticketNameEng || '', ticketNameKana: tk.ticketNameKana || '', spseatAdd1: 0, spseatAdd2: 0, spseatKbn: '000', limitUnit: tk.limitUnit || '001', limitCount: tk.limitCount || 1 });
  var reservations = this._auth.seats.map(function (id) { return { seatSection: (self._lastMap && self._lastMap[id] && self._lastMap[id].section) || '   ', seatNumber: toCoa(id), ticketInfo: ticketInfo(tk.ticketCode), ticketData: ticketData }; });
  var purchase = {
    salesTickets: this._tickets || [], couponTickets: [], memberTickets: [], movieTickets: [], pointTickets: [], orderCount: 0, incentive: 0, isCreditCardError: false,
    checkMovieTicketActions: [], movieTicketPaymentMethods: [], authorizeMovieTickets: [], isMultiple: false,
    reservations: reservations, updateAt: new Date().toISOString(), eventOffer: { eligibleQuantity: { maxValue: (this._coa && this._coa.availableNum) || 6 } },
    screeningEvent: this._event, seller: this._seller,
    transaction: { expires: this._txn.expires, id: this._txn.id, startDate: this._txn.startDate, clientId: (this._cred && this._cred.clientId) || '' },
    screen: this._screen, tmpSeatReservationAuthorization: { id: this._auth.id, result: this._auth.result }
  };
  var kv = { purchase: JSON.stringify(purchase), user: JSON.stringify({ native: '0', memberType: '0', updateAt: new Date().toISOString(), external: {} }) };
  if (this._config) kv.CONFIG = JSON.stringify(this._config);
  return '(function(){ if (location.host !== "transaction.ticket-cinemasunshine.com") return; var kv = ' + JSON.stringify(kv) + '; for (var k in kv) { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, kv[k]); } })();';
};

module.exports = { Sunshine, fromCoa, toCoa };
