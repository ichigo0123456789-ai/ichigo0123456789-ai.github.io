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

  /**
   * レイアウト定義を席の配列へ展開する。UI と混雑シミュの両方がこれを使う。
   *
   * 席番号は「スクリーンに向かって左から数えたグリッド位置」で、
   * **縦通路も番号を1つ消費する**。T・ジョイ横浜シアター4（全幅 4+15+4）なら
   * 左ブロックが 1〜4、通路が 5、中央が 6〜20、通路が 21、右が 22〜25。
   * 席の無い位置の番号は欠番になる（KINEZO の座席選択画面の実IDと同じ規則）。
   *
   * 席には番号 num のほかに
   *   block … 何番目の縦ブロックか（0=左, 1=中央, 2=右）
   *   col   … スクリーン全幅を席1つ=1として数えた横位置（0始まり・通路除く）
   * を持たせる。連席の判定は num の連続だけでは足りず、同一 block も要る
   * （通路をまたぐと番号は2飛ぶので通常は num でも切れるが、念のため）。
   */
  function expandSeats(screen) {
    /* 席番号 = スクリーンに向かって左からのグリッド位置（KINEZO の実採番）。
       col に番号をそのまま使えば、欠番（縦通路）が自然に空く。 */
    var out = [];
    screen.rows.forEach(function (r, rowIndex) {
      r.seatNums.forEach(function (num) {
        out.push({
          id: r.label + '-' + num,
          row: r.label,
          num: num,
          rowIndex: rowIndex,
          col: num,
          kind: r.kind,
          gapBefore: !!r.gapBefore
        });
      });
    });
    return out;
  }

  /** 通常の予約対象として選べる席か */
  function isSelectable(seat) {
    return seat.kind !== 'wheelchair';
  }

  /** スクリーンの横グリッド幅（席番号の最大値） */
  function screenWidth(screen) {
    return screen.gridWidth || 0;
  }

  /**
   * 席の「人気度」0〜1。混雑シミュで他ユーザーが埋める順番の重みになり、
   * 候補の自動生成（おすすめ席）でも同じ指標を使う。
   * スクリーンの横中央 & 前後方向は後ろ寄り 2/3 あたりが最も人気、という素朴なモデル。
   */
  function popularity(seat, screen) {
    var w = screenWidth(screen);
    var center = (w + 1) / 2;
    /* 横方向: スクリーン中央からの距離を全幅で正規化。
       列ごとの通し番号ではなく実際の横位置で測るので、
       片側の席が無い列（シアター4のK列など）も正しく評価できる。 */
    var lateral = center > 0 ? 1 - Math.abs(seat.col - center) / center : 1;
    /* 前後方向: 0=最前列, 1=最後列。ピークは 0.66 付近 */
    var depth = screen.rows.length > 1 ? seat.rowIndex / (screen.rows.length - 1) : 0.5;
    var depthScore = 1 - Math.abs(depth - 0.66) / 0.66;
    var score = 0.55 * lateral + 0.45 * Math.max(0, depthScore);
    /* 横通路の直後の列は足元が広く、実際に埋まるのが早い */
    if (seat.gapBefore) score = Math.min(1, score + 0.08);
    if (seat.kind === 'front') score *= 0.7;
    return Math.max(0.02, Math.min(1, score));
  }

  /**
   * 席を3軸で評価する（おすすめ席ランキング用）。
   *   offset : スクリーン中心からのズレ（席単位。負=左 / 正=右、客席からスクリーンを見た向き）。
   *            基準は「列の真ん中」ではなく「スクリーンの中心線」。KINEZO は席番号がスクリーン中心に
   *            対称な全体グリッドの列位置なので (gridWidth+1)/2 が中心線（T・ジョイ横浜ｼｱﾀｰ9で
   *            実際のピクセル座標と照合済み：E-9 は中心線の左0.49席）。列ブロック自体が中心から
   *            寄っている劇場では「列の真ん中」と一致しないことに注意。
   *   sound  : 音響 0〜100。中央寄り＋前後 0.62 付近（サラウンドの基準位置）がスイートスポット
   *   impact : 迫力 0〜100。画面が視野を満たす度合い＝前寄り（0.33 付近）で高く、中央寄りほど歪みが少ない
   * opts.geo: { centerX, pitchX, minX, maxX, yFront, yBack }（data/seatcoords.js のシアター情報）と
   * opts.pt : [x, y]（その席の中心 px）を渡すと実座標モード。無ければ席番号グリッドにフォールバック。
   * opts.eye: 'right' | 'left' | ''  利き目。「利き目をスクリーン中心線に置く」と顔の正中線は
   *           その分だけ逆側にずれる（右目→座席はわずかに左）。量は瞳孔間距離の半分≈3cm＝席幅の
   *           1割弱なので、順位付けでは「同点の席なら利き目側と逆（右目なら左）を優先」する程度の
   *           ごく僅かな補正（±0.1席）にとどめる。
   * rank    : 3軸＋利き目補正を合成した順位付け用スコア（0〜1）。表示は3軸、並び順は rank。
   */
  function seatAxes(seat, screen, opts) {
    opts = opts || {};
    var off, lat, depth, halfSeats, source;
    if (opts.geo && opts.pt) {
      /* 実座標モード：座席図の data-coords（席の中心 px）と、PNG を画素解析して実測した
         SCREEN バーの中心（opts.geo.centerX）から計算する。席番号や画像中心の仮定は使わない。
         推定値（実寸 m・傾斜）は一切含まない。 */
      var g = opts.geo;
      off = (opts.pt[0] - g.centerX) / g.pitchX;                       // 席単位。負=左, 正=右
      halfSeats = Math.max(0.5, ((g.maxX - g.minX) / 2) / g.pitchX);   // 客席の半幅（席単位）
      lat = Math.max(0, 1 - Math.abs(off) / halfSeats);
      depth = g.yBack > g.yFront ? Math.min(1, Math.max(0, (opts.pt[1] - g.yFront) / (g.yBack - g.yFront))) : 0.5; // 0=最前, 1=最後（実際の列間隔を反映）
      source = 'coords';
    } else {
      /* フォールバック：席番号グリッド（実座標が未取得のシアター用） */
      var w = screenWidth(screen);
      var center = (w + 1) / 2;
      off = center > 0 ? seat.col - center : 0;
      halfSeats = center > 0 ? center : 1;
      lat = center > 0 ? Math.max(0, 1 - Math.abs(off) / center) : 1;
      depth = screen.rows.length > 1 ? seat.rowIndex / (screen.rows.length - 1) : 0.5;
      source = 'grid';
    }
    /* 前後（迫力・音響・快適性）は実寸に近い物理モデルで出す。
       実測座標は上の「中央からの左右ズレ(off)」の特定にだけ使い、前後には使わない。
       画面の水平視野角 = 2*atan((画面幅/2)/距離)。近すぎ(角が大)は酔うので強めに減点、
       遠すぎ(角が小)は迫力不足として弱めに減点。最適は約38°（SMPTE/THXの中間）。 */
    var SEATW = 0.5, ROWPITCH = 1.0, FRONTGAP = 3.5, OPT = 38 * Math.PI / 180;
    var rows = (screen.rows || []).length || 1;
    var ri = seat.rowIndex || 0;
    var screenW = 2 * halfSeats * SEATW;                        // 画面幅(m)≒座席の左右範囲
    var dist = FRONTGAP + ri * ROWPITCH;                        // スクリーンまでの距離(m)
    var angle = 2 * Math.atan((screenW / 2) / dist);           // 画面の水平視野角(rad)
    var da = angle - OPT;
    var comfort = da >= 0 ? Math.max(0, 1 - (da / OPT) * 1.15)  // 近すぎ＝強めに減点
                          : Math.max(0, 1 - (-da / OPT) * 0.7);  // 遠すぎ＝弱めに減点
    var depthFrac = rows > 1 ? ri / (rows - 1) : 0.5;
    var soundDepth = Math.max(0, 1 - Math.abs(depthFrac - 0.6) / 0.6); // 音響は中〜後方が良い
    var sound = Math.round(100 * (0.5 * lat + 0.5 * soundDepth));
    var immersion = Math.max(0, Math.min(1, angle / OPT));      // 画面占有＝最適角で1.0に飽和
    var impact = Math.round(100 * (0.6 * immersion + 0.4 * lat));
    var ideal = opts.eye === 'right' ? -0.1 : (opts.eye === 'left' ? 0.1 : 0); // 同点席の利き目タイブレーク
    var latEye = Math.max(0, 1 - Math.abs(off - ideal) / halfSeats);
    /* 総合＝中央(利き目補正)と“近すぎない最適視野角(comfort)”を主軸に、音響・迫力を副次で加点。 */
    var rank = 0.32 * latEye + 0.34 * comfort + 0.17 * (sound / 100) + 0.17 * (impact / 100);
    if (seat.gapBefore) rank = Math.min(1, rank + 0.02); // 横通路直後は足元が広い
    var n = Math.round(Math.abs(off) * 2) / 2;
    return { offset: off, offsetN: n, offsetDir: n === 0 ? '' : (off < 0 ? '左' : '右'), sound: sound, impact: impact, comfort: Math.round(comfort * 100), angleDeg: Math.round(angle * 180 / Math.PI), rank: rank, source: source };
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
      /* 車椅子スペースは一般の座席選択では押さえられない */
      if (!isSelectable(s)) { blocked[s.id] = true; return; }
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
    isSelectable: isSelectable,
    popularity: popularity,
    seatAxes: seatAxes,
    CONGESTION: CONGESTION,
    MockAdapter: MockAdapter
  };
})();
