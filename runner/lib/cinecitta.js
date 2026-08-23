/* ============================================================
   チネチッタ川崎（CiNE-T = SMART THEATER / cinerino 系 API）アダプタ
   ------------------------------------------------------------
   予約サイト reserve.smart-theater.com は Angular SPA で、裏側は JSON API：
     reserve.smart-theater.com/api/authorize/getCredentials → Bearer トークン（ゲスト）
     cloud.smart-theater.com/projects/<P>/events?…           → 上映回（開始時刻・残席・発売開始時刻つき）
     cloud.smart-theater.com/projects/<P>:<seller>/seats / seatOffers → 座席一覧と空席状況
     waiter.smart-theater.com/projects/<P>/passports         → 入場券（混雑制御＝待機列相当）
     apis.smart-theater.com/txn/…/transactions/PlaceOrder/start → 取引開始（15分）
     apis.smart-theater.com/txn/…/offers/EventService/authorize → 座席確保（仮押さえ）
   券種選択・決済は、取引状態(sessionStorage SESSION_STATE)を実ブラウザに注入して
   #/purchase/cinema/ticket から人間が続ける（URL 受け渡しではない）。
   会員ログイン(login.member.cinecitta.co.jp)は未自動化＝ゲスト購入で進める。
   共通メソッド面: init/fetchSchedule/openShow/fetchSeatMap/login/isLoggedIn/secure/advanceToTicket/
                  hold/releaseHold/pageKind/metaRefreshSec/homeUrl/handoffUrl/handoffInitScript
   ============================================================ */
'use strict';
const { request, CookieJar } = require('./http');

var R = 'https://reserve.smart-theater.com';
var C = 'https://cloud.smart-theater.com';
var T = 'https://apis.smart-theater.com/txn';
var W = 'https://waiter.smart-theater.com';
var APP_VERSION = '7.36.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
/* SPA が sessionStorage に置くプロジェクト設定（公開値。引き継ぎ時にそのまま入れる） */
var PROJECT_JSON = { projectId: 'cinecitta-production', storageUrl: { application: 'https://smarttheaterproduction.blob.core.windows.net/frontend/projects/cinecitta-production', common: 'https://smarttheaterproduction.blob.core.windows.net/pos/projects/cinecitta-production' }, env: 'production', gtmId: 'GTM-PV7X54C', analyticsId: '', gmoTokenUrl: 'https://static.mul-pay.jp/ext/js/token.js', sonyTokenUrl: 'https://www.e-scott.jp/euser/stn/CdGetJavaScript.do', nsTokenUrl: 'https://cashier-pro.s3.ap-northeast-1.amazonaws.com/sdk/v2.0.0/nsssdk.js', atoneUrl: 'https://im.np-payment-gateway.com/module/np.js', secureTranRetUrl: 'https://reserve.smart-theater.com/return/3d-secure/onPaymentAuthenticated' };

function Cinecitta(opt) {
  opt = opt || {};
  this.project = opt.project || 'cinecitta-production';
  this.theaterCode = opt.theaterCode || '001';
  this.name = opt.name || 'チネチッタ';
  this.jar = new CookieJar();
  this.base = R; this.chain = 'cinecitta'; this.guestOk = true;
  this.termsNote = 'CiNE-T の座席画面「利用規約に同意して次へ」は runner が API で代行できません。利用規約に同意のうえ使ってください。引き継いだブラウザの券種選択では「非会員」を選んで進めます（確保はゲストで行っています）。';
  this._cred = null; this._seller = null; this._theater = null;
  this._event = null; this._catalog = {}; this._sections = null; this._seats = null; this._txn = null; this._auth = null; this._kind = null;
}
Cinecitta.prototype.homeUrl = function () { return R + '/?projectId=' + this.project; };
Cinecitta.prototype.handoffUrl = function () { return R + '/?projectId=' + this.project + '#/purchase/cinema/ticket'; };
Cinecitta.prototype.pageKind = function () { return this._kind || 'unknown'; };
Cinecitta.prototype.metaRefreshSec = function () { return null; };
Cinecitta.prototype.isLoggedIn = function () { return false; };
Cinecitta.prototype.login = async function () { return { ok: false, reason: 'チネチッタ会員ログインは未対応（ゲスト購入で進めます）' }; };

/* ---- 低レベル ---- */
Cinecitta.prototype._token = async function () {
  if (this._cred && this._cred.expiryDate - Date.now() > 60000) return this._cred.accessToken;
  var res = await request({ method: 'POST', url: R + '/api/authorize/getCredentials', jar: this.jar,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: R, Referer: R + '/', 'User-Agent': UA }, body: '{"member":"0"}' });
  var j; try { j = JSON.parse(res.body); } catch (e) { throw new Error('SMART THEATER のトークン取得に失敗（' + res.status + '）'); }
  if (!j.accessToken) throw new Error('SMART THEATER のトークン取得に失敗: ' + res.body.slice(0, 200));
  this._cred = j; return j.accessToken;
};
Cinecitta.prototype._api = async function (method, url, body, extraHeaders) {
  var tok = await this._token();
  var h = Object.assign({ Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Content-Type': 'application/json', Origin: R, 'User-Agent': UA }, extraHeaders || {});
  var res = await request({ method: method, url: url, jar: this.jar, headers: h, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  var j = null; try { j = res.body ? JSON.parse(res.body) : null; } catch (e) { j = null; }
  return { status: res.status, json: j, body: res.body, headers: res.headers };
};
Cinecitta.prototype._get = async function (url) { var r = await this._api('GET', url); if (r.status >= 400) throw new Error('API ' + r.status + ' ' + url.slice(0, 80) + ' ' + String(r.body || '').slice(0, 160)); return r.json; };
/** limit=100 のページングを最後まで集める */
Cinecitta.prototype._all = async function (url) {
  var out = [];
  for (var p = 1; p < 30; p++) {
    var j = await this._get(url + '&limit=100&page=' + p);
    if (!Array.isArray(j)) break;
    out = out.concat(j); if (j.length < 100) break;
  }
  return out;
};
function jst(iso) { return new Date(new Date(iso).getTime() + 9 * 3600000).toISOString(); }
function hhmm(iso) { return jst(iso).slice(11, 16).replace(/^0/, ''); }
function ptMin(d) { var m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/); return m ? (parseInt(m[1] || 0, 10) * 60 + parseInt(m[2] || 0, 10)) : null; }

/* ---- 公開メソッド ---- */
Cinecitta.prototype.init = async function () {
  await this._token();
  var sellers = await this._get(C + '/projects/' + this.project + '/sellers?limit=10&page=1');
  this._seller = (sellers || [])[0] || null;
  if (!this._seller) throw new Error('販売者(seller)が取得できません');
  var th = await this._get(C + '/projects/' + this.project + '/places/MovieTheater?branchCode%5B%24eq%5D=' + this.theaterCode + '&page=1&limit=100');
  this._theater = (th || [])[0] || null;
  return { theaterId: this.theaterCode, sellerId: this._seller.id };
};

/** その日の上映回。shows[].onSale に発売開始時刻(ISO)が入る（API が返してくれる） */
Cinecitta.prototype.fetchSchedule = async function (dateStr) {
  var from = new Date(dateStr + 'T00:00:00+09:00').toISOString(), thru = new Date(dateStr + 'T23:59:59+09:00').toISOString();
  var ev = await this._all(C + '/projects/' + this.project + '/events?typeOf=ScreeningEvent&eventStatuses%5B0%5D=EventScheduled&startFrom=' + encodeURIComponent(from) + '&startThrough=' + encodeURIComponent(thru));
  var self = this, movies = {};
  ev.forEach(function (e) {
    if (e.superEvent && e.superEvent.location && e.superEvent.location.branchCode && e.superEvent.location.branchCode !== self.theaterCode) return;
    var ti = (e.name && e.name.ja) || (e.superEvent && e.superEvent.name && e.superEvent.name.ja) || ''; if (!ti) return;
    var wp = (e.superEvent && e.superEvent.workPerformed) || {};
    if (!movies[ti]) movies[ti] = { title: ti, filmCode: wp.identifier || null, runtime: ptMin(wp.duration), shows: [] };
    var room = e.location || {}; var mo = (((e.offers || {}).seller || {}).makesOffer || [])[0] || {};
    var rem = e.remainingAttendeeCapacity, max = e.maximumAttendeeCapacity;
    movies[ti].shows.push({
      showId: e.id, filmCode: wp.identifier || null, screen: String(parseInt(room.branchCode, 10) || room.branchCode), screenCode: room.branchCode,
      screenName: (room.name && room.name.ja) || ('CINE' + parseInt(room.branchCode, 10)),
      date: dateStr, time: hhmm(e.startDate), endTime: hhmm(e.endDate), status: rem == null ? null : (rem > 0 ? 'A' : 'X'), allSeats: max || null, remaining: rem,
      onSale: mo.validFrom || mo.availabilityStarts || null, listedFrom: mo.availabilityStarts || null, saleEnds: mo.validThrough || mo.availabilityEnds || null, // 購入可は validFrom（上映3日前 0:00）
      reserveUrl: 'cinecitta://' + e.id,
      params: { eventId: e.id, roomCode: room.branchCode, seriesId: e.superEvent && e.superEvent.id, workId: wp.identifier }
    });
  });
  return Object.keys(movies).map(function (t) { return movies[t]; });
};

/** 発売前の先読み：座席レイアウト（セクション・座席一覧）を取っておき、T0 の openShow を軽くする */
Cinecitta.prototype.prewarm = async function (show) {
  var p = (show && show.params) || {}; var eventId = p.eventId || (show && show.showId); if (!eventId) return;
  var evs = await this._get(C + '/projects/' + this.project + '/events?limit=1&page=1&typeOf=ScreeningEvent&id%5B%24eq%5D=' + eventId);
  var e = (evs || [])[0]; if (!e) return; var room = (e.location || {}).branchCode;
  if (this._seats && this._seatsRoom === room) return { ok: true };
  var base = C + '/projects/' + this.project + ':' + this._seller.id;
  this._sections = await this._all(base + '/seatSections?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room);
  var seats = {};
  for (var i = 0; i < this._sections.length; i++) {
    var sc = this._sections[i].branchCode;
    (await this._all(base + '/seats?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room + '&sectionCode=' + sc)).forEach(function (s) { seats[s.branchCode] = Object.assign({ section: sc }, s); });
  }
  this._seats = seats; this._seatsRoom = room;
  return { ok: true, seats: Object.keys(seats).length };
};

/** 上映回を開く＝最新の回情報＋座席一覧を取り、入場券(passport)→取引開始まで済ませる。
 *  発売前なら kind='notonsale'、混雑(waiter が 429/503)なら kind='waiting' として ok:false を返す。 */
Cinecitta.prototype.openShow = async function (show) {
  var p = (show && show.params) || {}; var eventId = p.eventId || (show && show.showId);
  if (!eventId) throw new Error('show.params.eventId がありません（fetchSchedule の結果を渡してください）');
  var self = this; this._kind = null;
  // 1) 回の最新情報（発売開始時刻を含む）
  var evs = await this._get(C + '/projects/' + this.project + '/events?limit=1&page=1&typeOf=ScreeningEvent&id%5B%24eq%5D=' + eventId);
  var e = (evs || [])[0]; if (!e) throw new Error('上映回が見つかりません: ' + eventId);
  this._event = e;
  var mo = (((e.offers || {}).seller || {}).makesOffer || [])[0] || {};
  var onSale = mo.validFrom || mo.availabilityStarts;
  if (onSale && Date.now() < new Date(onSale).getTime()) { this._kind = 'notonsale'; return { ok: false, kind: 'notonsale', url: this.homeUrl(), onSale: onSale }; }
  if (e.eventStatus && e.eventStatus !== 'EventScheduled') { this._kind = 'unknown'; return { ok: false, kind: 'unknown', url: this.homeUrl(), reason: e.eventStatus }; }
  var room = (e.location || {}).branchCode;
  // 2) 座席レイアウト＋引き継ぎ用カタログ（回ごとに1度だけ）
  if (!this._seats || this._seatsRoom !== room) {
    var base = C + '/projects/' + this.project + ':' + this._seller.id;
    this._sections = await this._all(base + '/seatSections?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room);
    var seats = {};
    for (var i = 0; i < this._sections.length; i++) {
      var sc = this._sections[i].branchCode;
      (await this._all(base + '/seats?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room + '&sectionCode=' + sc)).forEach(function (s) { seats[s.branchCode] = Object.assign({ section: sc }, s); });
    }
    this._seats = seats; this._seatsRoom = room;
  }
  // 3) 入場券 → 取引開始（既に有効な取引があれば使い回す）
  if (this._txn && new Date(this._txn.expires).getTime() - Date.now() > 3 * 60000) { this._kind = 'seat'; return { ok: true, url: R + '/#/purchase/cinema/seat', txn: this._txn.id }; }
  var pr = await this._api('POST', W + '/projects/' + this.project + '/passports', { scope: 'Transaction:PlaceOrder:' + this._seller.id });
  if (pr.status === 429 || pr.status === 503) { this._kind = 'waiting'; return { ok: false, kind: 'waiting', url: this.homeUrl(), reason: 'waiter ' + pr.status }; }
  if (!pr.json || !pr.json.token) throw new Error('入場券(passport)が取れません（' + pr.status + '）: ' + String(pr.body || '').slice(0, 160));
  var st = await this._api('POST', T + '/projects/' + this.project + '/transactions/PlaceOrder/start', {
    agent: { identifier: [{ name: 'userAgent', value: UA }, { name: 'application:version', value: APP_VERSION }, { name: 'analysis:transactionStartDate', value: new Date().toISOString() }] },
    object: { passport: { token: pr.json.token } }, seller: { id: this._seller.id } });
  if (!st.json || !st.json.id) {
    if (st.status === 429 || st.status === 503) { this._kind = 'waiting'; return { ok: false, kind: 'waiting', url: this.homeUrl(), reason: 'start ' + st.status }; }
    throw new Error('取引を開始できません（' + st.status + '）: ' + String(st.body || '').slice(0, 200));
  }
  this._txn = st.json; this._auth = null; this._kind = 'seat';
  return { ok: true, url: R + '/#/purchase/cinema/seat', txn: st.json.id, expires: st.json.expires };
};

/** 引き継ぎ用カタログ（作品・シリーズ・スクリーン・券種カタログ）を取る。確保後に runner から呼ばれる（T0 の経路には入れない） */
Cinecitta.prototype.prepareHandoff = async function () {
  var e = this._event; if (!e) return; var eventId = e.id; var room = (e.location || {}).branchCode;
  if (!this._catalog.eventId || this._catalog.eventId !== eventId) {
    var P = C + '/projects/' + this.project; var sup = e.superEvent || {}; var wp = sup.workPerformed || {};
    var c = { eventId: eventId };
    var rs = await Promise.all([
      this._get(P + '/eventSeries?location%5BbranchCode%5D%5B%24eq%5D=' + this.theaterCode + '&id%5B%24in%5D%5B0%5D=' + sup.id + '&page=1&limit=100&typeOf=ScreeningEventSeries'),
      this._get(P + '/creativeWorks/movie?page=1&limit=100&identifier%5B%24in%5D%5B0%5D=' + wp.identifier),
      this._get(P + '/places/ScreeningRoom?branchCode%5B%24eq%5D=' + room + '&containedInPlace%5BbranchCode%5D%5B%24eq%5D=' + this.theaterCode + '&page=1&limit=100'),
      this._get(P + '/events/' + eventId + '/hasOfferCatalog?limit=10&page=1&typeOf=ScreeningEvent').catch(function () { return []; })
    ]);
    c.series = (rs[0] || [])[0] || null; c.movie = (rs[1] || [])[0] || null; c.screen = (rs[2] || [])[0] || null;
    var cat = (rs[3] || [])[0]; c.items = [];
    if (cat && cat.id) { try { c.items = await this._all(P + '/events/' + eventId + '/offerCatalogItems?includedInDataCatalog%5Bid%5D=' + cat.id); } catch (err) { c.items = []; } }
    this._catalog = c;
  }
};

/** 座席状況 → { 'I-17': {id,row,num,state,section} } state: available|taken */
Cinecitta.prototype.fetchSeatMap = async function () {
  if (!this._event) throw new Error('先に openShow してください');
  var base = C + '/projects/' + this.project + ':' + this._seller.id, map = {}, self = this;
  Object.keys(this._seats || {}).forEach(function (id) { var m = id.match(/^([A-Z]+)-?(\d+)$/); map[id] = { id: id, row: m ? m[1] : id, num: m ? +m[2] : null, state: 'taken', section: self._seats[id].section }; });
  for (var i = 0; i < (this._sections || []).length; i++) {
    var sc = this._sections[i].branchCode;
    (await this._all(base + '/seatOffers?eventId=' + this._event.id + '&sectionCode=' + sc)).forEach(function (o) {
      var id = o.itemOffered && o.itemOffered.branchCode; if (!id) return;
      if (!map[id]) { var m = id.match(/^([A-Z]+)-?(\d+)$/); map[id] = { id: id, row: m ? m[1] : id, num: m ? +m[2] : null, state: 'taken', section: sc }; }
      map[id].state = o.availability === 'InStock' ? 'available' : 'taken';
    });
  }
  this._lastMap = map;
  return map;
};

function seatObj(id, section) { return { typeOf: 'Seat', seatingType: [], seatNumber: id, seatRow: '', seatSection: section, name: { ja: id, en: id }, subReservations: [], isAvailable: true }; }

/** 席を確保（offers/EventService/authorize）。券種は未指定(noOfferSpecified)＝ブラウザで選ぶ。 */
Cinecitta.prototype.secure = async function (seatIds) {
  if (!this._txn) return { ok: false, reason: '取引が開始されていません（openShow 未実行）' };
  var self = this, ids = [].concat(seatIds || []);
  if (this._auth) { // 前回の確保が残っていれば取引ごと取り消して取り直す（同一取引内の差し替えAPIは未確認）
    await this.releaseHold().catch(function () {});
    var re = await this.openShow({ params: { eventId: this._event.id } }); if (!re.ok) return { ok: false, reason: '取引の再開始に失敗: ' + (re.kind || '') };
  }
  var body = { object: { acceptedOffer: ids.map(function (id) {
      var sec = (self._seats[id] && self._seats[id].section) || (self._lastMap && self._lastMap[id] && self._lastMap[id].section) || ((self._sections || [])[0] || {}).branchCode || 's01';
      return { id: 'xxx', additionalProperty: [], itemOffered: { serviceOutput: { typeOf: 'EventReservation', reservedTicket: { typeOf: 'Ticket', ticketedSeat: seatObj(id, sec) }, subReservation: [] } } };
    }), reservationFor: { id: this._event.id } }, purpose: { id: this._txn.id, typeOf: 'PlaceOrder' }, instrument: [] };
  var r = await this._api('POST', T + '/projects/' + this.project + '/offers/EventService/authorize?purpose%5Bid%5D=' + this._txn.id + '&noOfferSpecified=1', body);
  if (r.status >= 200 && r.status < 300 && r.json && r.json.id) { this._auth = { id: r.json.id, seats: ids }; return { ok: true, seats: ids, authId: r.json.id }; }
  var reason = (r.json && (r.json.message || (r.json.errors && r.json.errors.map(function (x) { return x.message; }).join('; ')))) || ('HTTP ' + r.status);
  return { ok: false, reason: reason, status: r.status };
};
Cinecitta.prototype.advanceToTicket = async function () { return { ok: true, ticketUrl: this.handoffUrl() }; };
Cinecitta.prototype.hold = async function (seatIds) { var s = await this.secure(seatIds); if (!s.ok) return s; var a = await this.advanceToTicket(); return Object.assign({}, s, a); };
/** 仮押さえを解放＝取引ごと取消（PUT …/cancel は 204 を確認済み。失敗しても取引は15分で自動失効） */
Cinecitta.prototype.releaseHold = async function () { if (!this._auth) return { ok: true }; return this.cancelTransaction(); };
/** 座席レイアウトだけ取る（取引を開かない。add-theater の採取用） */
Cinecitta.prototype.fetchSeatLayout = async function (show) {
  var p = (show && show.params) || {}; var eventId = p.eventId || (show && show.showId);
  var evs = await this._get(C + '/projects/' + this.project + '/events?limit=1&page=1&typeOf=ScreeningEvent&id%5B%24eq%5D=' + eventId);
  var e = (evs || [])[0]; if (!e) return {};
  var room = (e.location || {}).branchCode, base = C + '/projects/' + this.project + ':' + this._seller.id, map = {};
  var secs = await this._all(base + '/seatSections?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room);
  for (var i = 0; i < secs.length; i++) {
    (await this._all(base + '/seats?movieTheaterCode=' + this.theaterCode + '&roomCode=' + room + '&sectionCode=' + secs[i].branchCode)).forEach(function (s) {
      var m = String(s.branchCode).match(/^([A-Z]+)-?(\d+)$/); map[s.branchCode] = { id: s.branchCode, row: m ? m[1] : s.branchCode, num: m ? +m[2] : null, state: 'available' };
    });
  }
  return map;
};
/** 取引ごと取り消す（テスト後の後始末用） */
Cinecitta.prototype.cancelTransaction = async function () {
  if (!this._txn) return { ok: true };
  var r = await this._api('PUT', T + '/projects/' + this.project + '/transactions/PlaceOrder/' + this._txn.id + '/cancel', {});
  if (r.status < 400) { this._txn = null; this._auth = null; }
  return { ok: r.status < 400, status: r.status };
};

/** 実ブラウザへ引き継ぐための sessionStorage 注入スクリプト（Playwright addInitScript 用） */
Cinecitta.prototype.handoffInitScript = function () {
  if (!this._txn || !this._auth || !this._event) throw new Error('引き継ぎ状態がありません（確保前）');
  var self = this, e = this._event, c = this._catalog || {};
  var sec = function (id) { return (self._seats[id] && self._seats[id].section) || 's01'; };
  var seatFull = function (id) { return { typeOf: 'Seat', seatingType: [], seatNumber: id, seatRow: '', seatSection: sec(id), offers: [{ availability: 'InStock', priceSpecification: { priceComponent: [] } }], name: { ja: id, en: id }, additionalProperty: [] }; };
  var seatPlace = function (id) { return { containedInPlace: { branchCode: sec(id) }, branchCode: id, name: { ja: id, en: id }, offers: [{ availability: 'InStock', priceSpecification: { priceComponent: [] } }], seatingType: [], additionalProperty: [] }; };
  var reservations = this._auth.seats.map(function (id) { return { seat: seatFull(id) }; });
  var authz = { id: this._auth.id, result: {} };
  var txn = { expires: this._txn.expires, id: this._txn.id, startDate: this._txn.startDate, clientId: (this._cred && this._cred.clientId) || '' };
  var pd = {
    reservations: reservations,
    reservationItems: [{ id: this._auth.id, screeningEvent: e, screeningEventSeries: c.series, reservations: reservations, screeningEventSeats: this._auth.seats.map(seatPlace) }],
    screeningEvent: e, screeningEventSeries: c.series, creativeWork: c.movie, ticketOffers: [], offerCatalogItems: c.items || [], addOnOffers: [],
    authorizeSeatReservation: authz, authorizeCreditCardPayments: [], authorizeMovieTicketPayments: [], checkMovieTickets: [], pendingMovieTickets: [],
    authorizeSeatReservations: [authz], paymentMethods: [], programMemberships: [], eventOfferTickets: [], transaction: txn,
    theater: this._theater, screen: c.screen, seller: this._seller
  };
  var kv = {
    SESSION_STATE: JSON.stringify({ App: { purchaseData: pd, orderData: { acceptedOffers: [] } } }),
    EXTERNAL: JSON.stringify({ projectId: this.project, eventId: e.id, userType: '0' }),
    PROJECT: JSON.stringify(PROJECT_JSON),
    'CINECITTA-PRODUCTION-FRONTEND-STATE': JSON.stringify({ App: { loading: false, process: '', error: null, userData: { login: false, language: 'ja', userType: '0', version: APP_VERSION } } })
  };
  return '(function(){ if (location.host !== "reserve.smart-theater.com") return; var kv = ' + JSON.stringify(kv) + '; for (var k in kv) { if (!sessionStorage.getItem(k)) sessionStorage.setItem(k, kv[k]); } })();';
};

module.exports = { Cinecitta };
