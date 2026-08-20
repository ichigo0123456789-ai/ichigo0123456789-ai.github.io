/* ============================================================
   劇場・スクリーンのマスタデータ — T・ジョイ横浜
   ------------------------------------------------------------
   全9スクリーンの座席配置は KINEZO の座席選択画面から採取した実データ
   （2026-08-20、theaterId=190）。席番号はスクリーンに向かって左からの
   通しグリッド位置で、KINEZO の <area id>（例 C-7）と一致する。
   縦通路はグリッド上の欠番（aisleCols）、横通路は列の欠落（aisleRows）
   として表される。

   row(label, ranges): ranges は席番号の圧縮表記。
     [[6,19]]           → 6〜19
     [[1,4],[6,20],[22,25]] → 1-4, 6-20, 22-25（5と21は縦通路で欠番）

   料金・発売タイミング・予約ルールは公開情報にもとづく。
   Phase 2 でこの座席データは runner が KINEZO から取得した実レイアウトで
   随時上書きできる（同じ形）。
   ============================================================ */

(function () {
  'use strict';

  /* 圧縮表記を席番号の配列へ展開。数値はそのまま、[a,b] は a..b。 */
  function expand(ranges) {
    var out = [];
    ranges.forEach(function (x) {
      if (typeof x === 'number') { out.push(x); return; }
      for (var n = x[0]; n <= x[1]; n++) out.push(n);
    });
    return out;
  }

  function row(label, ranges) {
    return { label: label, seatNums: expand(ranges) };
  }

  /**
   * スクリーンを組み立てる。
   * @param rows    row() の配列（スクリーン側＝前方から順）
   * @param opt     { format, surcharge, aisleRows:[列ラベル], aisleCols:[通路のグリッド番号], gridWidth }
   */
  function screen(id, name, rows, opt) {
    opt = opt || {};
    var aisleRows = {};
    (opt.aisleRows || []).forEach(function (r) { aisleRows[r] = true; });
    rows.forEach(function (r, i) {
      r.kind = i === 0 ? 'front' : (i === rows.length - 1 ? 'rear' : 'normal');
      r.gapBefore = !!aisleRows[r.label];
      r.count = r.seatNums.length;
    });
    var seats = 0;
    rows.forEach(function (r) { seats += r.count; });
    return {
      id: id, name: name, seats: seats,
      format: opt.format || null,
      surcharge: opt.surcharge || 0,
      gridWidth: opt.gridWidth || 0,
      aisleCols: (opt.aisleCols || []).slice(),
      source: 'kinezo-actual-2026-08-20',
      rows: rows
    };
  }

  var CHAINS = {
    tjoy: {
      id: 'tjoy',
      name: 'T・ジョイ（KINEZO）',
      onSaleRule: { daysBefore: 2, time: '00:00' },
      note: 'KINEZO のオンライン予約は鑑賞希望日の2日前 0:00 から。一部のイベント上映等は例外。',
      memberProgram: 'キネパス',
      rules: {
        maxSeats: 5,
        singleGap: { enforce: false, warn: true,
          note: '席と席の間に1席だけ空きを残す配置は、劇場によっては選択できません（KINEZO での扱いは未確認）' },
        notes: [
          '一度に予約できる座席は最大5席。6枚以上は申込みを複数回に分ける',
          '同一アカウント・同一上映回の「あとから決済」は合計10枚まで（支払期限を過ぎると自動キャンセル）',
          'オンライン予約は鑑賞希望日の2日前 0:00 から（イベント上映等は例外あり）',
          '座席予約は上映開始の1時間前まで。KINEZO の会員登録（無料）が必須',
          '決済完了後のキャンセル・変更・払い戻しは不可',
          'アクセス集中時は公式の仮想待合室に入り、順番待ちになる',
          '車椅子スペースはオンラインでは予約できず、劇場への問い合わせが必要'
        ],
        asOf: '2026-08-19'
      }
    }
  };

  var THEATERS = [
    {
      id: 'tjoy-yokohama',
      chain: 'tjoy',
      name: 'T・ジョイ横浜',
      area: '神奈川 / JR横浜タワー',
      pref: '神奈川県',
      address: '横浜市西区南幸1-1-1 JR横浜タワー 8F',
      station: 'JR横浜駅 直結',
      map: { x: 610, y: 560 },
      note: '全9スクリーン・1,212席。シアター4のみ DOLBY CINEMA。座席は KINEZO 実データ。',
      screens: [
      // シアター1：63席
      screen('s1', 'シアター1', [
        row('A', [[2,7]]),
        row('B', [[2,10]]),
        row('C', [[2,10]]),
        row('D', [[2,10]]),
        row('E', [[2,10]]),
        row('F', [[2,10]]),
        row('G', [[1,12]])
      ], { gridWidth: 12 }),
      // シアター2：79席
      screen('s2', 'シアター2', [
        row('A', [[7,15]]),
        row('B', [[5,17]]),
        row('C', [[5,17]]),
        row('D', [[5,17]]),
        row('E', [[5,17]]),
        row('F', [[1,18]])
      ], { gridWidth: 18 }),
      // シアター3：94席
      screen('s3', 'シアター3', [
        row('A', [[4,12]]),
        row('B', [[2,14]]),
        row('C', [[2,14]]),
        row('D', [[2,14]]),
        row('E', [[2,14]]),
        row('F', [[2,14],[17,18]]),
        row('G', [[1,18]])
      ], { gridWidth: 18 }),
      // シアター4：325席
      screen('s4', 'シアター4', [
        row('A', [[6,19]]),
        row('B', [[3,4],[6,20],[22,23]]),
        row('C', [[1,4],[6,20],[22,25]]),
        row('D', [[1,4],[6,20],[22,25]]),
        row('F', [[1,4],[6,20],[22,25]]),
        row('G', [[1,4],[6,20],[22,25]]),
        row('H', [[1,4],[6,20],[22,25]]),
        row('I', [[1,4],[6,20],[22,25]]),
        row('J', [[3,4],[6,20],[22,25]]),
        row('K', [[6,20],[22,25]]),
        row('M', [[2,4],[6,20],[22,25]]),
        row('N', [[1,4],[6,20],[22,25]]),
        row('O', [[1,4],[6,20],[22,25]]),
        row('P', [[1,4],[6,20],[22,25]]),
        row('Q', [[1,4],[6,20],[22,25]])
      ], { format: 'DOLBY CINEMA', surcharge: 600, aisleRows: ["F", "M"], aisleCols: [5, 21], gridWidth: 25 }),
      // シアター5：127席
      screen('s5', 'シアター5', [
        row('A', [[4,9]]),
        row('B', [[2,11]]),
        row('C', [[2,11]]),
        row('D', [[2,11]]),
        row('E', [[2,11]]),
        row('F', [[2,11]]),
        row('G', [[2,11]]),
        row('H', [[2,11]]),
        row('J', [[2,11],[14,15]]),
        row('K', [[2,11],[14,15]]),
        row('L', [[2,11],[14,15]]),
        row('M', [[1,15]])
      ], { aisleRows: ["J"], gridWidth: 15 }),
      // シアター6：201席
      screen('s6', 'シアター6', [
        row('A', [[6,14]]),
        row('B', [[4,16]]),
        row('C', [[4,16]]),
        row('D', [[4,16]]),
        row('E', [[4,16]]),
        row('F', [[4,16]]),
        row('G', [[4,16]]),
        row('H', [[4,16]]),
        row('I', [[4,16]]),
        row('J', [[4,16]]),
        row('L', [[1,2],[4,16]]),
        row('M', [[1,2],[4,16]]),
        row('N', [[1,2],[4,16]]),
        row('O', [[1,2],[4,16]]),
        row('P', [[4,18]])
      ], { aisleRows: ["L"], aisleCols: [3], gridWidth: 18 }),
      // シアター7：150席
      screen('s7', 'シアター7', [
        row('A', [[4,12]]),
        row('B', [[2,14]]),
        row('C', [[2,14]]),
        row('D', [[2,14]]),
        row('E', [[2,14]]),
        row('F', [[2,14]]),
        row('G', [[2,14]]),
        row('I', [[2,14],[17,18]]),
        row('J', [[2,14],[17,18]]),
        row('K', [[2,14],[17,18]]),
        row('L', [[1,18]])
      ], { aisleRows: ["I"], gridWidth: 18 }),
      // シアター8：79席
      screen('s8', 'シアター8', [
        row('A', [[7,15]]),
        row('B', [[5,17]]),
        row('C', [[5,17]]),
        row('D', [[5,17]]),
        row('E', [[5,17]]),
        row('F', [[1,18]])
      ], { gridWidth: 18 }),
      // シアター9：94席
      screen('s9', 'シアター9', [
        row('A', [[4,12]]),
        row('B', [[2,14]]),
        row('C', [[2,14]]),
        row('D', [[2,14]]),
        row('E', [[2,14]]),
        row('F', [[2,14],[17,18]]),
        row('G', [[1,18]])
      ], { gridWidth: 18 }),
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
