/* ============================================================
   上映作品と番組表（モック）
   ------------------------------------------------------------
   Phase 1 では KINEZO から実際の上映スケジュールを取得しないため、
   サンプルの作品リストから日付ごとの番組表を決定的に生成する。
   同じ日付なら何度開いても同じ番組表になる（プランの再現性のため）。

   Phase 2 ではここを「アダプタが取得した実スケジュールのキャッシュ」に
   置き換える。forDate() の返り値の形は変えない想定。
   ============================================================ */

(function () {
  'use strict';

  /* 実在の作品名を騙らないよう、明確なサンプル作品にしている */
  var MOVIES = [
    { id: 'm1', title: '星々のらせん', runtime: 142, rating: 'G',    tag: 'SF大作',        dolby: true  },
    { id: 'm2', title: '真夜中のマラソン', runtime: 118, rating: 'G',    tag: 'ヒューマンドラマ' },
    { id: 'm3', title: '紙飛行機の約束', runtime: 104, rating: 'G',    tag: 'アニメーション'   },
    { id: 'm4', title: '蒼の残響', runtime: 127, rating: 'PG12', tag: 'ミステリー'       },
    { id: 'm5', title: 'キッチンカー・ブルース', runtime: 96,  rating: 'G',    tag: 'コメディ'         },
    { id: 'm6', title: '雨のち、花火', runtime: 110, rating: 'G',    tag: '恋愛'             },
    { id: 'm7', title: '鋼のセレナーデ', runtime: 135, rating: 'PG12', tag: 'アクション'       },
    { id: 'm8', title: '図書館の幽霊たち', runtime: 99,  rating: 'G',    tag: 'ファミリー'       }
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
   * @returns [{ movie, shows: [{time, endTime, screenId, screenName, format, status}] }]
   *   status: 'many'(◎) | 'few'(残りわずか△) | 'soldout'(×) | 'presale'(発売前)
   */
  function forDate(theater, dateStr) {
    var rand = mulberry32(hashString(theater.id + '|' + dateStr));

    /* 発売済みかどうか。KINEZO は上映日の2日前 0:00 発売なので、
       「上映日 - 2日」が今日以前なら発売済みとして空席状況を出す。 */
    var p = dateStr.split('-');
    var showDay = new Date(+p[0], +p[1] - 1, +p[2]);
    var onSaleDay = new Date(showDay.getTime() - 2 * 86400000);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var onSale = onSaleDay <= today;

    /* スクリーンへの作品割当。DOLBY のスクリーンには dolby 作品を固定し、
       残りはシャッフルして順に割り当てる。 */
    var rest = MOVIES.filter(function (m) { return !m.dolby; }).slice();
    for (var i = rest.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    var tent = MOVIES.filter(function (m) { return m.dolby; })[0] || rest[0];

    var byMovie = {};
    var k = 0;
    theater.screens.forEach(function (sc) {
      var movie = sc.format ? tent : rest[k++ % rest.length];

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
    return { onSale: onSale, movies: out };
  }

  window.CINEMA_SCHEDULE = { movies: MOVIES, forDate: forDate };
})();
