/* ============================================================
   劇場・スクリーンのマスタデータ — T・ジョイ横浜
   ------------------------------------------------------------
   スクリーン数・各シアターの座席数・料金・発売タイミングは
   公開情報にもとづく実データ。ただし
   「どの列に何席あるか」までは公開されていないため、
   列ごとの配置は総席数が一致するよう生成した近似である。
   （シアター4だけは中央通路と車椅子席の位置が公開情報と一致する）

   Phase 2 でローカル runner を足す際は、ここを
   「アダプタが KINEZO から取得したレイアウトのキャッシュ」に置き換える。
   ============================================================ */

(function () {
  'use strict';

  /* 日本の映画館の慣例に合わせ、紛らわしい I と O を飛ばす */
  var ROW_LABELS = 'ABCDEFGHJKLMNPQRSTUVW'.split('');

  /**
   * 総席数 total を R 列に振り分ける。
   * 前方は狭く、奥行き 3/4 あたりで最大、最後列は少し狭い台形。
   * 端数は中央付近の列で吸収するので、合計は必ず total に一致する。
   */
  function distribute(total, R) {
    var w = [];
    for (var i = 0; i < R; i++) {
      var d = R > 1 ? i / (R - 1) : 0.5;
      w.push(0.72 + 0.42 * Math.min(1, d / 0.75) - 0.20 * Math.max(0, (d - 0.8) / 0.2));
    }
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var counts = w.map(function (x) { return Math.max(4, Math.round(total * x / sw)); });

    var diff = total - counts.reduce(function (a, b) { return a + b; }, 0);
    /* 差分を寄せる順番: 中央後方の列から */
    var pivot = (R - 1) * 0.66;
    var order = counts.map(function (_, i) { return i; }).sort(function (a, b) {
      return Math.abs(a - pivot) - Math.abs(b - pivot);
    });
    var k = 0;
    while (diff !== 0) {
      var i = order[k % R];
      if (diff > 0) { counts[i]++; diff--; }
      else if (counts[i] > 4) { counts[i]--; diff++; }
      k++;
    }
    return counts;
  }

  /**
   * スクリーンを1つ組み立てる。
   * @param id      スクリーンID
   * @param name    表示名
   * @param seats   総席数（公開情報）
   * @param opt     {rows, crossAisleAt, surcharge, format}
   *                crossAisleAt … 横通路を入れる列の位置（0〜1の深さ）
   */
  function makeScreen(id, name, seats, opt) {
    opt = opt || {};
    var R = opt.rows || Math.max(5, Math.round(Math.sqrt(seats / 1.55)));
    var counts = distribute(seats, R);
    var crossIndex = opt.crossAisleAt != null ? Math.round((R - 1) * opt.crossAisleAt) : -1;

    var rows = counts.map(function (c, i) {
      /* 縦通路: 大箱は2本、小箱は中央1本 */
      var aisles = c >= 16 ? [Math.round(c / 3), Math.round(c * 2 / 3)] : [Math.round(c / 2)];
      return {
        label: ROW_LABELS[i],
        count: c,
        aisles: aisles,
        kind: i === 0 ? 'front' : (i === R - 1 ? 'rear' : 'normal'),
        /* 横通路の直後の列は足元が広い。UI でも間隔を空けて描く。 */
        gapBefore: i === crossIndex
      };
    });

    /* 車椅子スペース。T・ジョイ横浜は全9シアターで18席 = 各シアター2席。
       位置が公開されているシアターは opt.wheelchair で明示し、
       それ以外は横通路沿いの両端に置く。 */
    var wheelchair;
    if (opt.wheelchair) {
      wheelchair = opt.wheelchair;
    } else {
      var wcRow = rows[crossIndex >= 0 ? crossIndex : Math.floor(R / 2)];
      wheelchair = [wcRow.label + '-1', wcRow.label + '-' + wcRow.count];
    }

    return {
      id: id,
      name: name,
      seats: seats,
      format: opt.format || null,
      surcharge: opt.surcharge || 0,
      wheelchair: wheelchair,
      rows: rows
    };
  }

  var CHAINS = {
    tjoy: {
      id: 'tjoy',
      name: 'T・ジョイ（KINEZO）',
      /* KINEZO のオンライン予約は鑑賞希望日の2日前 0:00 から。
         プラン作成時の発売開始日時の初期値をここから計算する。 */
      onSaleRule: { daysBefore: 2, time: '00:00' },
      note: 'KINEZO のオンライン予約は鑑賞希望日の2日前 0:00 から。一部のイベント上映等は例外。',
      memberProgram: 'キネパス'
    }
  };

  var THEATERS = [
    {
      id: 'tjoy-yokohama',
      chain: 'tjoy',
      name: 'T・ジョイ横浜',
      area: '神奈川 / JR横浜タワー',
      note: '全9スクリーン・1,212席。シアター4のみ DOLBY CINEMA。',
      screens: [
        makeScreen('s1', 'シアター1', 63, { rows: 6 }),
        makeScreen('s2', 'シアター2', 79, { rows: 7 }),
        makeScreen('s3', 'シアター3', 94, { rows: 8 }),
        /* J・K列が見やすい / M列の前が横通路 / 車椅子席はJ列とM列の入口付近、
           という公開情報に合わせて18列構成にしてある。 */
        makeScreen('s4', 'シアター4', 325, {
          rows: 18, crossAisleAt: 11 / 17, format: 'DOLBY CINEMA', surcharge: 600,
          wheelchair: ['J-1', 'M-1']
        }),
        makeScreen('s5', 'シアター5', 127, { rows: 9, crossAisleAt: 0.72 }),
        makeScreen('s6', 'シアター6', 201, { rows: 12, crossAisleAt: 0.72 }),
        makeScreen('s7', 'シアター7', 150, { rows: 10, crossAisleAt: 0.72 }),
        makeScreen('s8', 'シアター8', 79, { rows: 7 }),
        makeScreen('s9', 'シアター9', 94, { rows: 8 })
      ]
    }
  ];

  /* 2025年9月改定の鑑賞料金。ドルビーシネマは各料金に +600円。 */
  var TICKET_TYPES = [
    { id: 'general', name: '一般', price: 2200 },
    { id: 'univ', name: '大学生', price: 1600 },
    { id: 'high', name: '高校生', price: 1100 },
    { id: 'child', name: '小・中学生', price: 1100 },
    { id: 'senior', name: 'シニア（60歳以上）', price: 1300 },
    { id: 'disability', name: '障がい者割引', price: 1100 }
  ];

  window.CINEMA_DATA = {
    chains: CHAINS,
    theaters: THEATERS,
    ticketTypes: TICKET_TYPES,

    theater: function (id) {
      for (var i = 0; i < THEATERS.length; i++) if (THEATERS[i].id === id) return THEATERS[i];
      return null;
    },
    screen: function (theaterId, screenId) {
      var t = this.theater(theaterId);
      if (!t) return null;
      for (var i = 0; i < t.screens.length; i++) if (t.screens[i].id === screenId) return t.screens[i];
      return null;
    }
  };
})();
