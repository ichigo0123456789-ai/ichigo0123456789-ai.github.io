/* ============================================================
   映画館・スクリーンのマスタデータ（モック）
   ------------------------------------------------------------
   Phase 1 では実サイトへアクセスしないため、劇場名とスクリーンの
   座席レイアウトはこのファイルのハードコードを正とする。
   Phase 2 でローカル runner を足す際は、ここを
   「アダプタが実サイトから取得したレイアウトのキャッシュ」に
   差し替える想定。形（chains / theaters / screens.layout）は変えない。
   ============================================================ */

(function () {
  'use strict';

  /* 列レイアウトの短縮記法をほどく。
     "14" -> 1..14 の通し番号 / aisles は「その番号の後ろに通路」 */
  function row(label, count, aisles, kind) {
    return { label: label, count: count, aisles: aisles || [], kind: kind || 'normal' };
  }

  /* 標準的なシネコンのスクリーン（中規模・約200席） */
  function standardRows() {
    return [
      row('A', 12, [4, 8], 'front'),
      row('B', 14, [5, 9]),
      row('C', 16, [5, 11]),
      row('D', 16, [5, 11]),
      row('E', 18, [6, 12]),
      row('F', 18, [6, 12]),
      row('G', 18, [6, 12]),
      row('H', 18, [6, 12]),
      row('J', 18, [6, 12]),
      row('K', 16, [5, 11]),
      row('L', 14, [5, 9], 'rear')
    ];
  }

  /* 小箱（約90席） */
  function smallRows() {
    return [
      row('A', 8, [4], 'front'),
      row('B', 10, [5]),
      row('C', 12, [6]),
      row('D', 12, [6]),
      row('E', 12, [6]),
      row('F', 12, [6]),
      row('G', 10, [5]),
      row('H', 8, [4], 'rear')
    ];
  }

  /* IMAX / 大箱（約350席）。最後列にプレミアシートを置く */
  function largeRows() {
    return [
      row('A', 14, [5, 10], 'front'),
      row('B', 18, [6, 12]),
      row('C', 20, [7, 13]),
      row('D', 22, [7, 15]),
      row('E', 22, [7, 15]),
      row('F', 24, [8, 16]),
      row('G', 24, [8, 16]),
      row('H', 24, [8, 16]),
      row('J', 24, [8, 16]),
      row('K', 22, [7, 15]),
      row('L', 20, [7, 13]),
      row('M', 16, [5, 11], 'premium')
    ];
  }

  var CHAINS = {
    '109': {
      id: '109',
      name: '109シネマズ',
      /* 一般発売の慣例。プランを作るとき onSaleAt の初期値を計算するのに使う。
         実際の発売タイミングは劇場・作品で例外があるので UI 側で上書き可能にしてある。 */
      onSaleRule: { daysBefore: 2, time: '00:00' },
      note: '一般発売は上映日の2日前 0:00 が基本。シネマポイントカード会員は先行枠あり。',
      memberProgram: 'シネマポイントカード'
    },
    'united': {
      id: 'united',
      name: 'ユナイテッド・シネマ / シネプレックス',
      onSaleRule: { daysBefore: 2, time: '00:00' },
      note: '一般発売は上映日の2日前 0:00 が基本。CLUB-SPICE 会員は先行枠あり。',
      memberProgram: 'CLUB-SPICE'
    }
  };

  var THEATERS = [
    {
      id: '109-futako', chain: '109', name: '109シネマズ二子玉川', area: '東京',
      screens: [
        { id: 's1', name: 'シアター1', kind: 'large', rows: largeRows() },
        { id: 's2', name: 'シアター2', kind: 'standard', rows: standardRows() },
        { id: 's5', name: 'シアター5', kind: 'small', rows: smallRows() }
      ]
    },
    {
      id: '109-kawasaki', chain: '109', name: '109シネマズ川崎', area: '神奈川',
      screens: [
        { id: 's1', name: 'シアター1', kind: 'standard', rows: standardRows() },
        { id: 's7', name: 'シアター7', kind: 'large', rows: largeRows() },
        { id: 's9', name: 'シアター9', kind: 'small', rows: smallRows() }
      ]
    },
    {
      id: '109-grandberry', chain: '109', name: '109シネマズグランベリーパーク', area: '東京',
      screens: [
        { id: 'imax', name: 'IMAXシアター', kind: 'large', rows: largeRows() },
        { id: 's3', name: 'シアター3', kind: 'standard', rows: standardRows() }
      ]
    },
    {
      id: '109-expocity', chain: '109', name: '109シネマズ大阪エキスポシティ', area: '大阪',
      screens: [
        { id: 'imax', name: 'IMAXレーザーGT', kind: 'large', rows: largeRows() },
        { id: 's4', name: 'シアター4', kind: 'standard', rows: standardRows() }
      ]
    },
    {
      id: 'uc-toyosu', chain: 'united', name: 'ユナイテッド・シネマ豊洲', area: '東京',
      screens: [
        { id: 'imax', name: 'IMAXシアター', kind: 'large', rows: largeRows() },
        { id: 's6', name: 'スクリーン6', kind: 'standard', rows: standardRows() },
        { id: 's11', name: 'スクリーン11', kind: 'small', rows: smallRows() }
      ]
    },
    {
      id: 'uc-aquacity', chain: 'united', name: 'ユナイテッド・シネマ アクアシティお台場', area: '東京',
      screens: [
        { id: 's1', name: 'スクリーン1', kind: 'standard', rows: standardRows() },
        { id: 's5', name: 'スクリーン5', kind: 'small', rows: smallRows() }
      ]
    },
    {
      id: 'uc-urawa', chain: 'united', name: 'ユナイテッド・シネマ浦和', area: '埼玉',
      screens: [
        { id: 's3', name: 'スクリーン3', kind: 'standard', rows: standardRows() },
        { id: 's8', name: 'スクリーン8', kind: 'small', rows: smallRows() }
      ]
    },
    {
      id: 'cineplex-makuhari', chain: 'united', name: 'シネプレックス幕張', area: '千葉',
      screens: [
        { id: 's2', name: 'スクリーン2', kind: 'standard', rows: standardRows() }
      ]
    }
  ];

  /* 券種。人数の内訳を持たせて合計金額を出すのに使う（Phase 2 の決済で必要になる） */
  var TICKET_TYPES = [
    { id: 'general', name: '一般', price: 2000 },
    { id: 'member', name: '会員', price: 1600 },
    { id: 'univ', name: '大学生', price: 1500 },
    { id: 'high', name: '高校生以下', price: 1000 },
    { id: 'senior', name: 'シニア', price: 1300 },
    { id: 'disability', name: '障がい者割引', price: 1000 }
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
