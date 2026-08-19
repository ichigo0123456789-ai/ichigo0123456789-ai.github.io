/* ============================================================
   座席バックエンドのアダプタ境界
   ------------------------------------------------------------
   runner.js はこのインタフェースにしか依存しない。Phase 2 で
   ローカル runner（Node + Playwright）を足すときは、同じ4メソッドを
   持つ実サイト用アダプタを書いて差し替えるだけで済むようにしてある。

     open(plan)              -> {queuePosition} 上映回の座席選択画面を開く
     fetchSeatMap(plan)      -> {seats:{[seatId]:'available'|'taken'|'blocked'}}
     hold(plan, seatIds)     -> {ok, holdExpiresAt} | {ok:false, reason}
     release(plan, seatIds)  -> {ok}

   Phase 1 の実装は MockAdapter だけ。実サイトへは一切アクセスしない。
   ============================================================ */

(function () {
  'use strict';

  /* ---- 座席 ID とレイアウト展開 ------------------------------------ */

  /** レイアウト定義を席の配列へ展開する。UI と混雑シミュの両方がこれを使う。 */
  function expandSeats(screen) {
    var out = [];
    screen.rows.forEach(function (r, rowIndex) {
      for (var n = 1; n <= r.count; n++) {
        out.push({
          id: r.label + '-' + n,
          row: r.label,
          num: n,
          rowIndex: rowIndex,
          kind: r.kind,
          aisleAfter: r.aisles.indexOf(n) >= 0
        });
      }
    });
    return out;
  }

  /**
   * 席の「人気度」0〜1。混雑シミュで他ユーザーが埋める順番の重みになり、
   * 候補の自動生成（おすすめ席）でも同じ指標を使う。
   * スクリーンの横中央 & 前後方向は後ろ寄り 2/3 あたりが最も人気、という素朴なモデル。
   */
  function popularity(seat, screen) {
    var r = screen.rows[seat.rowIndex];
    var center = (r.count + 1) / 2;
    /* 横方向: 中央からの距離を列幅で正規化 */
    var lateral = 1 - Math.abs(seat.num - center) / center;
    /* 前後方向: 0=最前列, 1=最後列。ピークは 0.66 付近 */
    var depth = screen.rows.length > 1 ? seat.rowIndex / (screen.rows.length - 1) : 0.5;
    var depthScore = 1 - Math.abs(depth - 0.66) / 0.66;
    var score = 0.55 * lateral + 0.45 * Math.max(0, depthScore);
    if (seat.kind === 'premium') score = Math.min(1, score + 0.15);
    if (seat.kind === 'front') score *= 0.7;
    return Math.max(0.02, Math.min(1, score));
  }

  /* ---- 混雑プリセット ---------------------------------------------- */

  /* seatsPerSec: 発売直後に他ユーザーが席を埋めていく速さ（席/秒）
     decay:       時間が経つと落ち着く度合い（半減期・秒）
     preTaken:    発売開始時点で既に埋まっている割合（先行販売ぶん）
     blocked:     販売対象外（間隔調整・機材席など）の割合
     queueSec:    発売直後の待機列で待たされる秒数
     raceLoss:    確保リクエストが競合に負ける確率（発売直後） */
  var CONGESTION = {
    quiet:   { label: '空いている',   seatsPerSec: 0.4, decay: 60, preTaken: 0.05, blocked: 0.02, queueSec: 0,  raceLoss: 0.02 },
    normal:  { label: '普通',         seatsPerSec: 2.0, decay: 45, preTaken: 0.12, blocked: 0.02, queueSec: 1,  raceLoss: 0.08 },
    busy:    { label: '激戦',         seatsPerSec: 8.0, decay: 30, preTaken: 0.25, blocked: 0.03, queueSec: 5,  raceLoss: 0.22 },
    frenzy:  { label: '争奪戦',       seatsPerSec: 22.0, decay: 20, preTaken: 0.40, blocked: 0.03, queueSec: 15, raceLoss: 0.40 }
  };

  /* ---- 決定的な擬似乱数 -------------------------------------------- */
  /* 同じシードなら同じ結果になるようにしておく。リハーサルの再現性のため。 */
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

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ---- モックアダプタ ---------------------------------------------- */

  /**
   * 実サイトの代わりに「他ユーザーが席を取っていく劇場」を再現する。
   * 時刻は runner から渡される now(ms) を使う。発売開始からの経過秒だけで
   * 席の埋まり具合が決まるので、早送りリハーサルでも挙動が一致する。
   */
  function MockAdapter(opts) {
    opts = opts || {};
    var screen = opts.screen;
    var cfg = CONGESTION[opts.congestion] || CONGESTION.normal;
    var seats = expandSeats(screen);
    var rand = mulberry32(hashString(opts.seed || 'default'));

    /* 各席に「他ユーザーに取られる時刻（発売開始からの秒）」を先に割り当てておく。
       人気席ほど早い時刻になる。こうしておくと fetchSeatMap は O(n) の判定で済み、
       ポーリング間隔を変えても結果がぶれない。 */
    var takenAt = {};   /* seatId -> 秒 (Infinity = 最後まで空席) */
    var blocked = {};

    seats.forEach(function (s) {
      if (rand() < cfg.blocked) { blocked[s.id] = true; return; }
      var pop = popularity(s, screen);
      if (rand() < cfg.preTaken * (0.4 + pop)) { takenAt[s.id] = -1; return; }  /* 発売前に確定済み */
      /* 指数分布っぽく: 人気席ほどレートが高い = 早く埋まる */
      var rate = cfg.seatsPerSec * pop / seats.length * 6;
      var u = rand();
      var t = rate > 0 ? -Math.log(1 - u) / rate : Infinity;
      /* 時間が経つと購入ペースが落ちる（decay 秒で実質的に止まる）ので、
         遅い当選時刻はさらに後ろへ引き伸ばす */
      if (t > cfg.decay) t = cfg.decay + (t - cfg.decay) * 4;
      takenAt[s.id] = t;
    });

    var heldByMe = {};   /* 自分が確保した席 */

    this.seats = seats;
    this.screen = screen;
    this.congestion = cfg;

    /** 発売開始からの経過秒 */
    function elapsed(ctx) {
      return (ctx.now - ctx.onSaleAt) / 1000;
    }

    /** 通信の揺らぎ。実サイト相手のときの体感に寄せる。 */
    this.latency = function () {
      return 80 + Math.floor(rand() * 320);
    };

    this.open = function (ctx) {
      var e = elapsed(ctx);
      /* 発売直後は待機列。時間が経つほど短くなる。 */
      var wait = e < 0 ? cfg.queueSec : Math.max(0, cfg.queueSec * (1 - e / Math.max(1, cfg.decay)));
      return { ok: true, queueSec: Math.round(wait * 10) / 10 };
    };

    this.fetchSeatMap = function (ctx) {
      var e = elapsed(ctx);
      var map = {};
      seats.forEach(function (s) {
        if (blocked[s.id]) { map[s.id] = 'blocked'; return; }
        if (heldByMe[s.id]) { map[s.id] = 'mine'; return; }
        var t = takenAt[s.id];
        map[s.id] = (t !== undefined && t <= e) ? 'taken' : 'available';
      });
      return { ok: true, seats: map, fetchedAt: ctx.now };
    };

    this.hold = function (ctx, seatIds) {
      var e = elapsed(ctx);
      if (e < 0) return { ok: false, reason: 'not_on_sale' };

      for (var i = 0; i < seatIds.length; i++) {
        var id = seatIds[i];
        if (blocked[id]) return { ok: false, reason: 'blocked', seat: id };
        var t = takenAt[id];
        if (t !== undefined && t <= e) return { ok: false, reason: 'taken', seat: id };
      }
      /* 取得できるはずでも、リクエスト往復の間に他ユーザーに抜かれることがある。
         発売直後ほど負けやすい。 */
      var lossRate = cfg.raceLoss * Math.max(0.1, 1 - e / Math.max(1, cfg.decay));
      if (rand() < lossRate) {
        var victim = seatIds[Math.floor(rand() * seatIds.length)];
        takenAt[victim] = e;   /* 抜かれた席は以後 taken 扱い */
        return { ok: false, reason: 'race_lost', seat: victim };
      }
      seatIds.forEach(function (id) { heldByMe[id] = true; takenAt[id] = -1; });
      return { ok: true, holdExpiresAt: ctx.now + 10 * 60 * 1000, seats: seatIds.slice() };
    };

    this.release = function (ctx, seatIds) {
      seatIds.forEach(function (id) { delete heldByMe[id]; delete takenAt[id]; });
      return { ok: true };
    };
  }

  window.CinemaEngine = {
    expandSeats: expandSeats,
    popularity: popularity,
    CONGESTION: CONGESTION,
    MockAdapter: MockAdapter
  };
})();
