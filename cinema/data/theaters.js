/* ============================================================
   劇場・スクリーンのマスタデータ — T・ジョイ横浜
   ------------------------------------------------------------
   スクリーン数・各シアターの座席数・料金・発売タイミングは
   公開情報にもとづく実データ。

   シアター4（DOLBY CINEMA）は、KINEZO の座席選択画面
   （予約フローの画面。ログイン前に表示でき、全325席の <area id="C-7"> の
   ような実IDと座標を含む）と照合済みで、**席IDが実物と完全一致する**。
     出典: https://tjoy.jp/t-joy_yokohama/facilities （座席図 map_04.png）
           /t-joy_yokohama/reservation/index/... → choice_seat（実ID）
   それ以外のシアターは、列ごとの配置が公開されていないため
   総席数が一致するよう生成した近似のまま（makeScreen）。

   Phase 2 でローカル runner を足す際は、ここを
   「アダプタが KINEZO から取得したレイアウトのキャッシュ」に置き換える。
   ============================================================ */

(function () {
  'use strict';

  /* ---- 行（列）の共通形 --------------------------------------------
     blocks      … 縦通路で区切られたブロックごとの席数。[左, 中央, 右]。
                   0 のブロックは「その列にはその位置の席が無い」を表す。
     wheelchair  … 行頭に置かれた車椅子スペースの幅（座席何個ぶんか）の配列。
     gapBefore   … この列の手前が横通路。
     kind        … front / normal / rear。
     count       … 販売席数（blocks の合計）。車椅子スペースは含めない。
     ------------------------------------------------------------------ */
  function makeRow(label, blocks, opt) {
    opt = opt || {};
    var count = blocks.reduce(function (a, b) { return a + b; }, 0);
    return {
      label: label,
      blocks: blocks.slice(),
      count: count,
      wheelchair: (opt.wheelchair || []).slice(),
      gapBefore: !!opt.gapBefore,
      kind: opt.kind || 'normal'
    };
  }

  /** 行の集合から、ブロックごとの最大幅を出す。座席表の桁を揃えるのに使う。 */
  function blockWidths(rows) {
    var n = 0;
    rows.forEach(function (r) { n = Math.max(n, r.blocks.length); });
    var w = [];
    for (var i = 0; i < n; i++) {
      var m = 0;
      rows.forEach(function (r) { m = Math.max(m, r.blocks[i] || 0); });
      w.push(m);
    }
    return w;
  }

  function finishScreen(id, name, rows, opt) {
    opt = opt || {};
    var seats = 0, wc = 0;
    rows.forEach(function (r) { seats += r.count; wc += r.wheelchair.length; });
    return {
      id: id,
      name: name,
      seats: seats,
      wheelchairSeats: wc,
      format: opt.format || null,
      surcharge: opt.surcharge || 0,
      source: opt.source || 'approx',
      rows: rows,
      blockWidths: blockWidths(rows)
    };
  }

  /* ============================================================
     シアター4（DOLBY CINEMA）— KINEZO の実データと一致
     ------------------------------------------------------------
     ・15列 325席 ＋ 車椅子スペース2。
     ・縦通路は2本。全幅は 4 + 15 + 4 = 23 席ぶん。
     ・E列・L列は欠番。その位置が横通路になっている
       （D列とF列のあいだ／K列とM列のあいだ）。
     ・席番号はスクリーンに向かって左から数えたグリッド位置で、
       縦通路が 5 と 21 を消費する（expandSeats がこの規則で振る）。
       全325席の ID が KINEZO の座席選択画面の <area id> と一致することを
       照合済み: C〜I・N〜Q = 1-4/6-20/22-25、B = 3,4/6-20/22,23、
       J = 3,4/6-20/22-25、K = 6-20/22-25、M = 2-4/6-20/22-25、A = 6-19。
     ・A列は中央ブロックに14席で、前後の列とは半席ずれて並ぶ
       （KINEZO では A列だけ type-seat="10"。意味は未確認）。
     ・J列の車椅子スペースは左端の2席ぶん（番号 1・2 の位置）、
       M列は1席ぶん（番号 1 の位置）を占める。KINEZO の座席選択画面には
       車椅子スペースの <area> は無い（オンラインでは販売されない）。
     ============================================================ */
  function theater4Rows() {
    var W = [4, 15, 4];
    return [
      makeRow('A', [0, 14, 0], { kind: 'front' }),
      makeRow('B', [2, 15, 2]),
      makeRow('C', [4, 15, 4]),
      makeRow('D', [4, 15, 4]),
      /* ---- 横通路（E列は欠番）---- */
      makeRow('F', [4, 15, 4], { gapBefore: true }),
      makeRow('G', W),
      makeRow('H', W),
      makeRow('I', W),
      makeRow('J', [2, 15, 4], { wheelchair: [2] }),
      makeRow('K', [0, 15, 4]),
      /* ---- 横通路（L列は欠番）---- */
      makeRow('M', [3, 15, 4], { gapBefore: true, wheelchair: [1] }),
      makeRow('N', W),
      makeRow('O', W),
      makeRow('P', W),
      makeRow('Q', [4, 15, 4], { kind: 'rear' })
    ];
  }

  /* ============================================================
     公開されていないシアターの近似レイアウト
     ------------------------------------------------------------
     総席数だけを合わせ、前方が狭く奥行き 3/4 あたりで最大になる
     台形を作る。列ごとの席数・席番号は実際の座席表とは一致しない。
     ============================================================ */

  /* 日本の映画館の慣例に合わせ、紛らわしい I と O を飛ばす */
  var ROW_LABELS = 'ABCDEFGHJKLMNPQRSTUVW'.split('');

  /** 総席数 total を R 列に振り分ける。合計は必ず total に一致する。 */
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

  /** 席数 c の列を [左, 中央, 右] に割る。縦通路は常に2本。 */
  function splitRow(c) {
    var side = Math.max(2, Math.round(c * 0.18));
    if (c - 2 * side < 4) side = Math.max(0, Math.floor((c - 4) / 2));
    return [side, c - 2 * side, side];
  }

  /**
   * 近似レイアウトのスクリーンを1つ組み立てる。
   * @param seats  総席数（公開情報）
   * @param opt    {rows, crossAisleAt, surcharge, format}
   *               crossAisleAt … 横通路を入れる列の位置（0〜1の深さ）
   */
  function makeScreen(id, name, seats, opt) {
    opt = opt || {};
    var R = opt.rows || Math.max(5, Math.round(Math.sqrt(seats / 1.55)));
    var counts = distribute(seats, R);
    var crossIndex = opt.crossAisleAt != null ? Math.round((R - 1) * opt.crossAisleAt) : -1;
    /* 車椅子スペースは全9シアターで18 = 各シアター2。
       位置は公開されていないので、横通路沿いの列の行頭にまとめて置く。 */
    var wcIndex = crossIndex >= 0 ? crossIndex : Math.floor(R / 2);

    var rows = counts.map(function (c, i) {
      return makeRow(ROW_LABELS[i], splitRow(c), {
        gapBefore: i === crossIndex,
        wheelchair: i === wcIndex ? [1, 1] : [],
        kind: i === 0 ? 'front' : (i === R - 1 ? 'rear' : 'normal')
      });
    });

    return finishScreen(id, name, rows, {
      format: opt.format, surcharge: opt.surcharge, source: 'approx'
    });
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
      note: '全9スクリーン・1,212席（＋車椅子18席）。シアター4のみ DOLBY CINEMA。',
      screens: [
        makeScreen('s1', 'シアター1', 63, { rows: 6 }),
        makeScreen('s2', 'シアター2', 79, { rows: 7 }),
        makeScreen('s3', 'シアター3', 94, { rows: 8 }),
        finishScreen('s4', 'シアター4', theater4Rows(), {
          format: 'DOLBY CINEMA', surcharge: 600, source: 'official'
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
