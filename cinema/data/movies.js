/* ============================================================
   上映作品と番組表
   ------------------------------------------------------------
   作品リストは T・ジョイ横浜で実際に上映中のラインナップ
   （2026-08-19 時点、映画情報サイトの掲載から採取）。
   上映**時間帯**までは取得できていないため、番組表の時刻は
   作品の上映時間から日付ごとに決定的に生成したサンプルのまま。
   同じ日付なら何度開いても同じ番組表になる（プランの再現性のため）。

   Phase 2 ではここを「アダプタが KINEZO から取得した実スケジュールの
   キャッシュ」に置き換える。forDate() の返り値の形は変えない想定。
   ============================================================ */

(function () {
  'use strict';

  var AS_OF = '2026-08-19';

  /* until: リバイバル上映などの終了日。過ぎた日付の番組表には載せない。 */
  var MOVIES = [
    { id: 'eupho',   title: '最終楽章 響け！ユーフォニアム 前編',
      runtime: 120, note: '2026/8/14公開', dolby: true },
    { id: 'shinchan', title: '映画クレヨンしんちゃん 奇々怪々！オラの妖怪バケ～ション',
      runtime: 100, note: '2026/7/31公開' },
    { id: 'oakstreet', title: 'オークストリートの異変',
      runtime: 100, note: '2026/8/14公開' },
    { id: 'abyss',   title: '劇場版メイドインアビス 深き魂の黎明',
      runtime: 105, note: 'リバイバル上映 〜8/20', until: '2026-08-20' },
    { id: 'madoka',  title: '劇場版 魔法少女まどか☆マギカ ［新編］叛逆の物語',
      runtime: 116, note: 'リバイバル上映 〜8/27', until: '2026-08-27' }
  ];

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toHM(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  /**
   * 指定日の番組表を返す。
   * @returns { onSale, asOf, movies: [{ movie, shows: [{time,endTime,screenId,screenName,format,status}] }] }
   *   status: 'many'(◎) | 'few'(残りわずか) | 'soldout'(売切) | 'presale'(発売前)
   */
  function forDate(theater, dateStr) {
    var rand = mulberry32(hashString(theater.id + '|' + dateStr));

    /* 発売済みかどうか。KINEZO は上映日の2日前 0:00 発売。 */
    var p = dateStr.split('-');
    var showDay = new Date(+p[0], +p[1] - 1, +p[2]);
    var onSaleDay = new Date(showDay.getTime() - 2 * 86400000);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var onSale = onSaleDay <= today;

    /* その日に上映している作品だけを対象にする */
    var lineup = MOVIES.filter(function (m) { return !m.until || dateStr <= m.until; });

    /* スクリーンへの割当。DOLBY のスクリーンには dolby 作品を固定し、
       全スクリーンには全作品（dolby 作品の通常上映を含む）を
       シャッフルして順に割り当てる。作品数よりスクリーンが多いので、
       大作は複数スクリーンで上映される（実際のシネコンと同じ）。 */
    var rot = lineup.slice();
    for (var i = rot.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = rot[i]; rot[i] = rot[j]; rot[j] = tmp;
    }
    var tent = lineup.filter(function (m) { return m.dolby; })[0] || rot[0];

    var byMovie = {};
    var k = 0;
    theater.screens.forEach(function (sc) {
      var movie = sc.format ? tent : rot[k++ % rot.length];

      /* 初回 8:50〜10:30、以降は本編＋清掃25〜35分で繰り返し、21:40 まで */
      var t = 530 + Math.floor(rand() * 20) * 5;
      var shows = [];
      while (t <= 1300 && shows.length < 5) {
        var status;
        if (!onSale) {
          status = 'presale';
        } else {
          var r = rand();
          status = r < 0.68 ? 'many' : (r < 0.90 ? 'few' : 'soldout');
        }
        shows.push({
          time: toHM(t),
          endTime: toHM(t + movie.runtime),
          screenId: sc.id,
          screenName: sc.name,
          format: sc.format || null,
          status: status
        });
        t += movie.runtime + 25 + Math.floor(rand() * 3) * 5;
        t = Math.ceil(t / 5) * 5;
      }

      if (!byMovie[movie.id]) byMovie[movie.id] = { movie: movie, shows: [] };
      byMovie[movie.id].shows = byMovie[movie.id].shows.concat(shows);
    });

    var out = [];
    Object.keys(byMovie).forEach(function (id) {
      byMovie[id].shows.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      out.push(byMovie[id]);
    });
    /* DOLBY 作品を先頭に、あとはタイトル順 */
    out.sort(function (a, b) {
      if (a.movie.dolby !== b.movie.dolby) return a.movie.dolby ? -1 : 1;
      return a.movie.title < b.movie.title ? -1 : 1;
    });
    return { onSale: onSale, asOf: AS_OF, movies: out };
  }

  window.CINEMA_SCHEDULE = { movies: MOVIES, forDate: forDate, asOf: AS_OF };
})();
