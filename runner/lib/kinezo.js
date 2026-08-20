/* ============================================================
   KINEZO 実サイトアダプタ（認証不要の範囲）
   ------------------------------------------------------------
   cinema/engine.js のアダプタ境界（open / fetchSeatMap / hold / release）
   に対応する実接続版。ただし現時点で実装するのは認証不要のメソッド:

     fetchSchedule(dateStr)  … その日の実番組表（作品・時刻・スクリーン・残席）
     openShow(show)          … reservation/index → choice_seat のセッション確立
     fetchSeatMap()          … choice_seat の <area> から空席/売切を読む

   hold / login / 決済は認証が必要なため未実装（権限が開いてから Phase 2b）。
   調査根拠は cinema/KINEZO-RESEARCH.md。
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
  this._csrfSeat = csrfToken(res.body);
  return { ok: /choice_seat/.test(res.url), url: res.url };
};

/** choice_seat の座席状況（実データ）。openShow の後に呼ぶ。 */
Kinezo.prototype.fetchSeatMap = function () {
  if (!this._seatHtml) throw new Error('先に openShow() を呼んでください');
  return parseSeatMap(this._seatHtml);
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
