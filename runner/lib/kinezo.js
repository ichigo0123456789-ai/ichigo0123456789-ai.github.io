/* ============================================================
   KINEZO 実サイトアダプタ（認証不要の範囲）
   ------------------------------------------------------------
   cinema/engine.js のアダプタ境界（open / fetchSeatMap / hold / release）
   に対応する実接続版。ただし現時点で実装するのは認証不要のメソッド:

     fetchSchedule(dateStr)  … その日の実番組表（作品・時刻・スクリーン・残席）
     openShow(show)          … reservation/index → choice_seat のセッション確立
     fetchSeatMap()          … choice_seat の <area> から空席/売切を読む

   login / hold は cinema/KINEZO-RESEARCH.md の実フロー（§6, §7）に基づき実装。
   認証情報は引数で受け取るだけで、インスタンスにもログにも一切残さない。
   決済（choice_ticket 以降）は人間に渡す設計のため未実装。
   ============================================================ */

'use strict';

const { request, CookieJar } = require('./http');

var BASE = 'https://tjoy.jp';

/** HTML から hidden input / meta の値を取る */
function pick(html, re) {
  var m = html.match(re);
  return m ? m[1] : null;
}
function csrfToken(html) {
  return pick(html, /name="csrf-token"\s+content="([^"]*)"/) ||
         pick(html, /id="csrfToken"[^>]*value="([^"]*)"/) ||
         pick(html, /name="_csrfToken"[^>]*value="([^"]*)"/);
}
/** name 指定で hidden input の value を取る */
function hiddenVal(html, name) {
  var re = new RegExp('name="' + name + '"[^>]*value="([^"]*)"');
  var m = html.match(re);
  if (m) return m[1];
  // value が name より前に来るパターンも拾う
  re = new RegExp('value="([^"]*)"[^>]*name="' + name + '"');
  m = html.match(re);
  return m ? m[1] : null;
}
/** id 指定で input の value を取る */
function idVal(html, id) {
  return pick(html, new RegExp('id="' + id + '"[^>]*value="([^"]*)"')) ||
         pick(html, new RegExp('value="([^"]*)"[^>]*id="' + id + '"'));
}
function form(obj) {
  return Object.keys(obj).map((k) => k + '=' + encodeURIComponent(obj[k] == null ? '' : obj[k])).join('&');
}

/**
 * @param opt { theaterPath: 't-joy_yokohama', theaterId: '190' }
 */
function Kinezo(opt) {
  this.theaterPath = opt.theaterPath;
  this.theaterId = opt.theaterId;
  this.jar = new CookieJar();
  this.csrf = null;
}

/** 劇場トップを開いて CSRF とセッションを確立 */
Kinezo.prototype.init = async function () {
  var res = await request({ url: BASE + '/' + this.theaterPath, jar: this.jar });
  this.csrf = csrfToken(res.body);
  this.theaterId = this.theaterId || pick(res.body, /id="theaterId"\s+value="([^"]*)"/);
  if (!this.csrf) throw new Error('CSRF トークンを取得できませんでした');
  return { theaterId: this.theaterId };
};

/** 指定日の番組表（実データ） */
Kinezo.prototype.fetchSchedule = async function (dateStr) {
  if (!this.csrf) await this.init();
  var body = 'data=' + encodeURIComponent(JSON.stringify({ date: dateStr, theaterId: this.theaterId })) +
             '&_csrfToken=' + encodeURIComponent(this.csrf);
  var res = await request({
    method: 'POST',
    url: BASE + '/theaterTop/scheduleGetHtmlApi',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': BASE + '/' + this.theaterPath + '/theater_cinema' },
    body: body, jar: this.jar
  });
  return parseSchedule(res.body);
};

/** 上映回の予約フローを開き、choice_seat のセッションを確立（ログイン不要） */
Kinezo.prototype.openShow = async function (show) {
  var url = BASE + show.reserveUrl;
  var res = await request({ url: url, jar: this.jar, followRedirect: true,
    headers: { 'Referer': BASE + '/' + this.theaterPath + '/theater_cinema' } });
  this._seatHtml = res.body;
  this._seatUrl = res.url;
  // hold() に必要な値を choice_seat の hidden から確保
  this._csrfSeat = idVal(res.body, 'csrfToken') || csrfToken(res.body);
  this._scheduleId = hiddenVal(res.body, 'scheduleId') || (show && show.showId);
  this._seatTheaterId = hiddenVal(res.body, 'theaterId') || this.theaterId;
  return { ok: /choice_seat/.test(res.url), url: res.url, scheduleId: this._scheduleId };
};

/** choice_seat の座席状況（実データ）。openShow の後に呼ぶ。 */
Kinezo.prototype.fetchSeatMap = function () {
  if (!this._seatHtml) throw new Error('先に openShow() を呼んでください');
  return parseSeatMap(this._seatHtml);
};

/* ---- 認証・座席確保（KINEZO-RESEARCH.md §6, §7） ------------------- */

/**
 * 会員ログイン。email / password は「この呼び出しの間だけ」使う。
 * インスタンスにもログにも保存しない。戻り値にも生の値は含めない。
 * @returns { ok, reason }
 */
Kinezo.prototype.login = async function (email, password) {
  if (!email || !password) throw new Error('メールとパスワードが必要です');
  // 1) ログインページを GET → CSRF cookie とフォームトークンを同じ jar に載せる
  var page = await request({ url: BASE + '/' + this.theaterPath + '/login', jar: this.jar });
  var token = hiddenVal(page.body, '_csrfToken') || csrfToken(page.body);
  if (!token) return { ok: false, reason: 'CSRFトークン取得失敗（ページ構造の変更かも）' };
  if (/recaptcha|hcaptcha|g-recaptcha/i.test(page.body)) {
    return { ok: false, reason: 'CAPTCHAが出現。自動ログインを中止し人間に引き継ぎます' };
  }
  // 2) 認証情報を POST（本文はローカル変数のみ。ここでも値はログ出力しない）
  var body = form({ _method: 'POST', _csrfToken: token, email: email, password: password, food_order: '' });
  var res = await request({
    method: 'POST', url: BASE + '/' + this.theaterPath + '/login', jar: this.jar,
    headers: { 'Referer': BASE + '/' + this.theaterPath + '/login', 'Origin': BASE },
    body: body, followRedirect: true
  });
  // 3) 成否判定：ログインフォームが再表示されていれば失敗
  var stillLogin = /name="password"/.test(res.body) && /\/login/.test(res.url);
  if (stillLogin) {
    var errM = res.body.match(/class="[^"]*(?:error|alert|flash)[^"]*"[^>]*>\s*([^<]{2,80})/i);
    return { ok: false, reason: 'ログイン失敗' + (errM ? '：' + decode(errM[1]) : '（メール/パスワードをご確認ください）') };
  }
  var ok = await this.isLoggedIn();
  return { ok: ok, reason: ok ? 'ログイン成功' : 'ログイン状態を確認できませんでした' };
};

/** 会員ログイン済みか（劇場トップの会員導線で判定） */
Kinezo.prototype.isLoggedIn = async function () {
  var res = await request({ url: BASE + '/' + this.theaterPath, jar: this.jar });
  // ログアウト導線／マイページがあればログイン済み、login リンクだけならば未ログイン
  if (/\/logout|ログアウト|\/mypage|マイページ/.test(res.body)) return true;
  if (new RegExp('/' + this.theaterPath + '/login"').test(res.body)) return false;
  return false;
};

/**
 * 座席確保（仮予約）。openShow のあと、ログイン済みで呼ぶ。
 * seatIds は area の id 形式（例 ["A-2","A-3"]）。
 * choiceSeatSave が done を返した時点で「席を掴んだ」状態。
 * その後 choice_ticket まで進めて停止（券種・決済は人間へ）。
 * @returns { ok, code, atTicket, reason }
 */
Kinezo.prototype.hold = async function (seatIds) {
  var s = await this.secure(seatIds);
  if (!s.ok) return s;
  var a = await this.advanceToTicket();
  return { ok: true, code: 'done', atTicket: a.atTicket, ticketUrl: a.ticketUrl,
    reason: '席を確保しました。券種選択・決済はブラウザで人間が完了してください' };
};

/**
 * 席を掴む（choiceSeatSave のみ）。ここが勝敗の決まる点。最短で返す。
 * @returns { ok, code, reason }
 */
Kinezo.prototype.secure = async function (seatIds) {
  if (!this._seatHtml) throw new Error('先に openShow() を呼んでください');
  if (!Array.isArray(seatIds) || !seatIds.length) throw new Error('確保する座席IDを渡してください');
  if (!this._csrfSeat) return { ok: false, reason: 'choice_seat の CSRF を取得できていません' };
  var payload = JSON.stringify({ scheduleId: this._scheduleId, theaterId: this._seatTheaterId, seatArr: seatIds });
  var res = await request({
    method: 'POST', url: BASE + '/reservation/choiceSeatSave', jar: this.jar,
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': this._seatUrl || (BASE + '/' + this.theaterPath + '/reservation/choice_seat') },
    body: form({ data: payload, _csrfToken: this._csrfSeat })
  });
  var code = null;
  try { code = (JSON.parse(res.body) || {}).result_code; } catch (e) { code = null; }
  if (code !== 'done') {
    var reason = code === '28' ? '仮予約タイムアウト（発売前 or セッション切れ）'
      : code === 'error' ? 'サーバがerror（席が既に埋まった/重複予約の可能性）'
      : '想定外の応答（code=' + code + '）。安全のため停止します';
    return { ok: false, code: code, reason: reason };
  }
  return { ok: true, code: 'done', reason: '席を掴みました（仮予約成立）' };
};

/** 確保後、券種選択画面へ前進する（勝敗確定の後処理。決済は人間）。 */
Kinezo.prototype.advanceToTicket = async function () {
  var adv = await request({
    method: 'POST', url: BASE + '/' + this.theaterPath + '/reservation/choice_ticket', jar: this.jar,
    headers: { 'Referer': this._seatUrl || BASE }, followRedirect: true,
    body: form({ _method: 'POST', _csrfToken: this._csrfSeat, scheduleId: this._scheduleId, theaterId: this._seatTheaterId })
  });
  this._ticketUrl = adv.url;
  var atTicket = /choice_ticket|reservation/.test(adv.url) && !/choice_seat/.test(adv.url);
  return { ok: true, atTicket: atTicket, ticketUrl: adv.url };
};

/**
 * openShow 後の到達画面を種別判定する（待機列対応の中核）。
 *   seat      … choice_seat（座席選択に到達＝掴める）
 *   waiting   … 混雑/順番待ち（正直に待って再取得する）
 *   notonsale … 販売期間外/発売前（発売枠入りを待つ）
 *   login     … セッション切れ（再ログイン）
 *   captcha   … 確認画面（人間に引き継ぐ）
 *   unknown   … 想定外（安全のため停止）
 */
Kinezo.prototype.pageKind = function (html, url) {
  html = html || ''; url = url || '';
  if (/choice_seat/.test(url)) return 'seat';
  if (/g-recaptcha|hcaptcha|recaptcha|data-sitekey/i.test(html)) return 'captcha';
  if (/しばらくお待ち|順番にご案内|順番待ち|アクセスが集中|ただいま.{0,6}混雑|大変混み合|混雑して|only a moment|waiting[\s-]?room|queue-it/i.test(html)) return 'waiting';
  if (/\/login(\/|$|\?)/.test(url) || /name="password"/.test(html)) return 'login';
  if (/販売期間外|発売前|販売しておりません|受付時間外|お取り扱い時間外|時間外です/.test(html)) return 'notonsale';
  return 'unknown';
};

/** meta refresh の秒数（あれば）。待機時の再取得間隔に使う。 */
Kinezo.prototype.metaRefreshSec = function (html) {
  var m = (html || '').match(/http-equiv=["']?refresh["']?[^>]*content=["']?\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
};

/** 仮予約を解放する（掴んだ席を手放す） */
Kinezo.prototype.releaseHold = async function () {
  try {
    await request({
      method: 'POST', url: BASE + '/reservation/cancel_temporary_reservation_which_exists', jar: this.jar,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: form({ _csrfToken: this._csrfSeat })
    });
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
};

/* ---- パーサ ------------------------------------------------------- */

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

/** scheduleGetHtmlApi の HTML から上映回を抽出 */
function parseSchedule(html) {
  var movies = {};
  /* 予約フローURL単位で走査（1回 = 1リンク） */
  var re = /reservation\/index\/(\d+)\/([A-Z0-9]+)\/(\d+)\/([\d-]+)\?type=film/g;
  var m;
  var seen = {};
  while ((m = re.exec(html)) !== null) {
    var key = m[1] + '/' + m[3];
    if (seen[key]) continue;
    seen[key] = true;
    var idx = m.index;
    /* 直近の作品名（このリンクより前で最も近い js-title-film） */
    var before = html.slice(0, idx);
    var titleM = before.match(/<h5[^>]*js-title-film[^>]*>([^<]+)<\/h5>(?![\s\S]*<h5[^>]*js-title-film)/);
    var title = titleM ? decode(titleM[1]) : '(不明)';
    /* このリンク周辺の時刻 */
    var around = html.slice(idx, idx + 1000);
    var timeM = around.match(/schedule-time[^>]*>\s*(\d{1,2}:\d{2})\s*<span>\s*[～〜]\s*(\d{1,2}:\d{2})/);
    var runtimeM = before.match(/（本編：(\d+)分）(?![\s\S]*（本編：)/);
    var fmtDolby = /DolbyCinema/i.test(title);
    var fid = m[2];
    if (!movies[title]) {
      movies[title] = {
        title: title, filmCode: fid,
        runtime: runtimeM ? parseInt(runtimeM[1], 10) : null,
        dolby: fmtDolby, shows: []
      };
    }
    /* 予約URLの劇場パスは onclick=location.href='/t-joy_yokohama/reservation/...' から取る */
    var pathM = around.match(/\/([a-z_]+)\/reservation\/index/);
    var theaterPath = pathM ? pathM[1] : 't-joy_yokohama';
    movies[title].shows.push({
      showId: m[1], filmCode: m[2], screen: m[3], date: m[4],
      time: timeM ? timeM[1] : null, endTime: timeM ? timeM[2] : null,
      reserveUrl: '/' + theaterPath + '/reservation/index/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + m[4] + '?type=film'
    });
  }
  return Object.keys(movies).map((t) => movies[t]);
}

/** choice_seat の <area> から座席状況を読む */
function parseSeatMap(html) {
  var seats = {};
  var re = /<area\s+id="([^"]+)"[^>]*type-seat="([^"]*)"[^>]*class="([^"]*)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var id = m[1];
    if (!/^[A-Z]+-?\d+$/.test(id)) continue;
    var cls = m[3];
    var state = /sold-out/.test(cls) ? 'taken' : (/seat-select/.test(cls) ? 'available' : 'blocked');
    seats[id] = { state: state, typeSeat: m[2] };
  }
  return seats;
}

module.exports = { Kinezo, parseSchedule, parseSeatMap };
