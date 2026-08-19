/* ============================================================
   予約ランナー（チェーン非依存のオーケストレーション）
   ------------------------------------------------------------
   「発売時刻を待つ → 席を確保する → 取れなければ空くのを待つ」というループ本体。
   アダプタ（engine.js の MockAdapter / Phase 2 の実サイトアダプタ）と
   時計（Clock）にしか依存しないので、Phase 2 ではそのまま流用できる。

   ■ 発売の瞬間の速さについて
   欲しい席が決まっているなら、座席表を取ってから確保するのは1往復ぶん遅い。
   holdFirst が有効なとき、発売の瞬間は座席表を挟まずいきなり確保を投げる。
   失敗して初めて座席表を取りにいく。

   ■ レート制限について
   ポーリング間隔には MIN_POLL_MS の下限を強制している。相手サイトへの
   連打は規約違反であり、そもそも弾かれて成功率も下がる。UI 側で
   これより短い値を入れても、ここで切り上げてログに残す。
   ただし発売直後だけは、まだ発売前だと返された場合に限り、
   BURST_MS 間隔・BURST_MAX 回までの再試行を認める（人が数回リロードする程度）。
   ============================================================ */

(function () {
  'use strict';

  var MIN_POLL_MS = 500;      /* これ以上速くポーリングしない（ハード下限） */
  var MAX_REQUESTS = 400;     /* 1回の実行で出すリクエストの総数上限 */
  var BURST_MS = 200;         /* 発売直後、「まだ発売前」と返されたときの再試行間隔 */
  var BURST_MAX = 5;          /* その再試行の上限回数 */
  /* 座席表を見ずに確保を投げてよい時間帯。発売直後はほぼ全席空いているので
     空振りしないが、時間が経つと埋まった席を撃って1往復ぶん損をする。 */
  var HOLD_FIRST_WINDOW_MS = 5000;

  /* ---- 時計 --------------------------------------------------------
     speed > 1 で早送り。リハーサルで「発売の瞬間」を待たずに検証するため。 */
  function Clock(opts) {
    opts = opts || {};
    this.speed = opts.speed || 1;
    /* サーバ時刻との差。TimeSync で測った値を入れると、
       手元の時計がずれていても発売の瞬間を正しく捉えられる。 */
    this.offset = opts.offset || 0;
    this._base = opts.base != null ? opts.base : Date.now();
    this._start = Date.now();
  }
  Clock.prototype.now = function () {
    return this._base + (Date.now() - this._start) * this.speed + this.offset;
  };
  /** 仮想時間で ms 待つ */
  Clock.prototype.sleep = function (ms) {
    var real = Math.max(0, ms / this.speed);
    return new Promise(function (res) { setTimeout(res, real); });
  };

  /* ---- ランナー ---------------------------------------------------- */

  /**
   * @param {object} o
   *   o.plan     予約プラン（候補の優先順リストを含む）
   *   o.adapter  座席バックエンド
   *   o.clock    Clock
   *   o.onLog    (entry) => void
   *   o.onState  (state, detail) => void
   */
  function Runner(o) {
    this.plan = o.plan;
    this.adapter = o.adapter;
    this.clock = o.clock || new Clock();
    this.onLog = o.onLog || function () {};
    this.onState = o.onState || function () {};

    /* 発売の瞬間ちょうどに発火させるための高精度タイマー。
       無い環境（Node のテスト等）では素の待機にフォールバックする。 */
    var self0 = this;
    this.timer = (typeof window !== 'undefined' && window.CinemaSpeed && this.clock.speed === 1)
      ? new window.CinemaSpeed.PreciseTimer(function () { return self0.clock.now(); })
      : null;
    this.timeline = [];

    this.state = 'idle';
    this.aborted = false;
    this.requests = 0;
    this.attempts = 0;
    this.result = null;
    this.seatMap = null;
    this.triedCandidates = [];
    /* 候補ごとに「前回どの席が埋まっていたか」を覚えておく。
       毎周期おなじ行を出すとログが読めなくなるので、変化したときだけ記録する。 */
    this._lastBlocked = {};
  }

  Runner.prototype._log = function (level, msg, extra) {
    var entry = {
      t: this.clock.now(),
      /* 発売開始からの相対秒。ログはこれで読むのが一番わかりやすい */
      rel: (this.clock.now() - this.plan.onSaleAt) / 1000,
      level: level,
      msg: msg,
      extra: extra || null
    };
    this.onLog(entry);
    return entry;
  };

  Runner.prototype._setState = function (s, detail) {
    this.state = s;
    this.onState(s, detail || null);
  };

  /** どこに何ms使ったかを残す。速くなったと言い張らず、測って示すため。 */
  Runner.prototype._mark = function (label) {
    var t = this.clock.now();
    var prev = this.timeline.length ? this.timeline[this.timeline.length - 1].t : null;
    this.timeline.push({
      label: label, t: t,
      rel: t - this.plan.onSaleAt,
      delta: prev != null ? t - prev : 0
    });
    return t;
  };

  /** 同期済み時計で targetTime まで待つ。高精度タイマーがあればそれを使う。 */
  Runner.prototype._waitUntil = function (targetTime) {
    var self = this;
    var remain = targetTime - this.clock.now();
    if (remain <= 0) return Promise.resolve(0);
    if (!this.timer) return this.clock.sleep(remain).then(function () { return null; });
    return new Promise(function (res) {
      self._pending = self.timer.at(targetTime, function (drift) { res(drift); });
    });
  };

  Runner.prototype.abort = function () {
    if (this._pending) this._pending.cancel();
    this.aborted = true;
    this._log('warn', '中止しました');
    this._setState('aborted');
  };

  /** アダプタ呼び出しを通信レイテンシ込みでラップし、総リクエスト数を数える */
  Runner.prototype._call = function (fn, args) {
    var self = this;
    this.requests++;
    var lat = this.adapter.latency ? this.adapter.latency() : 120;
    return this.clock.sleep(lat).then(function () {
      var ctx = { now: self.clock.now(), onSaleAt: self.plan.onSaleAt };
      return fn.call(self.adapter, ctx, args);
    });
  };

  /** 候補のうち空いていない席を返す。空配列なら全席確保できる状態。 */
  function blockingSeats(seatMap, seats) {
    return seats.filter(function (id) { return seatMap[id] !== 'available'; });
  }

  Runner.prototype.run = function () {
    var self = this;
    var plan = this.plan;
    var st = plan.strategy || {};

    var pollMs = Math.max(MIN_POLL_MS, st.pollIntervalMs || 1000);
    if ((st.pollIntervalMs || 1000) < MIN_POLL_MS) {
      this._log('warn', 'ポーリング間隔が下限を下回るため ' + MIN_POLL_MS + 'ms に切り上げました');
    }
    var deadlineMs = (st.deadlineSec || 180) * 1000;
    var preconnectMs = (st.preconnectSec || 10) * 1000;

    this._log('info', 'プラン「' + plan.title + '」を実行します', {
      theater: plan.theaterName, screen: plan.screenName,
      show: plan.date + ' ' + plan.showtime,
      seats: (plan.candidates[0] || {}).seats
    });

    return Promise.resolve()
      /* --- 1. 発売開始まで待つ（preconnect の分だけ手前で起こす） --- */
      .then(function () {
        var untilPre = plan.onSaleAt - preconnectMs - self.clock.now();
        if (untilPre > 0) {
          self._setState('waiting');
          self._log('info', '発売開始まで待機します（' + Math.round(untilPre / 1000) + '秒）');
          return self.clock.sleep(untilPre);
        }
      })
      /* --- 2. 事前接続：座席選択画面を開いて待機列を消化しておく --- */
      .then(function () {
        if (self.aborted) return;
        self._setState('connecting');
        self._log('info', '座席選択画面へ接続します');
        self._mark('事前接続 開始');
        return self._call(self.adapter.open).then(function (r) {
          self._mark('事前接続 完了');
          if (r && r.queueSec > 0) {
            self._log('warn', '待機列に入りました（約' + r.queueSec + '秒）');
            return self.clock.sleep(r.queueSec * 1000).then(function () {
              self._mark('待機列 通過');
            });
          }
        });
      })
      /* --- 3. 発売の瞬間ちょうどまで待つ --- */
      .then(function () {
        if (self.aborted) return;
        var remain = plan.onSaleAt - self.clock.now();
        if (remain > 0) {
          self._log('info', '発売開始まであと ' + (remain / 1000).toFixed(1) + '秒');
        }
        return self._waitUntil(plan.onSaleAt).then(function (drift) {
          if (drift != null) {
            self._log('info', '発売時刻ちょうどに発火（ズレ ' +
              (drift >= 0 ? '+' : '') + drift.toFixed(1) + 'ms）');
          }
        });
      })
      /* --- 4. 確保ループ --- */
      .then(function () {
        if (self.aborted) return;
        self._setState('hunting');
        self._log('ok', '発売開始。座席の確保を開始します');
        self._mark('発売開始');
        var startedAt = self.clock.now();
        return self._huntLoop(startedAt, deadlineMs, pollMs);
      })
      .then(function () {
        if (!self.result && !self.aborted && self.state !== 'failed') {
          self._setState('failed', { reason: 'exhausted' });
        }
        return self.result;
      });
  };

  Runner.prototype._succeed = function (h, target) {
    this.result = {
      seats: h.seats,
      rank: target.rank,
      heldAt: this.clock.now(),
      holdExpiresAt: h.holdExpiresAt,
      elapsedMs: this.clock.now() - this.plan.onSaleAt,
      elapsedSec: (this.clock.now() - this.plan.onSaleAt) / 1000,
      timeline: this.timeline.slice()
    };
    this._log('ok', '確保しました: ' + h.seats.join(' / ') +
      '（発売開始から ' + Math.round(this.result.elapsedMs) + 'ms）');
    this._setState('held', this.result);
    return 'done';
  };

  Runner.prototype._logHoldFailure = function (reason, h) {
    var seat = (h && h.seat) ? h.seat : '';
    if (reason === 'race_lost') {
      this._log('err', seat + ' を他のユーザーに先に取られました');
    } else if (reason === 'taken') {
      this._log('err', seat + ' は既に売切です');
    } else if (reason === 'not_on_sale') {
      this._log('warn', 'まだ発売開始前でした。少し待って再試行します');
    } else {
      this._log('err', '確保に失敗しました（' + reason + '）');
    }
  };

  Runner.prototype._huntLoop = function (startedAt, deadlineMs, pollMs) {
    var self = this;
    var plan = this.plan;
    var st = plan.strategy || {};
    /* 発売の瞬間だけは座席表を挟まず、いきなり確保を投げる。
       欲しい席が決まっているなら、座席表の1往復ぶん確保が遅れるだけで
       得るものが無い。失敗したときに初めて座席表を取りにいく。 */
    var holdFirst = st.holdFirst !== false;
    if (holdFirst && self.clock.now() - plan.onSaleAt > HOLD_FIRST_WINDOW_MS) {
      /* 発売からだいぶ経ってから始めた場合、目当ての席はもう埋まっている
         可能性が高い。空振りする往復のほうが高くつくので座席表から入る。 */
      holdFirst = false;
      self._log('dim', '発売からの経過が大きいため、座席表の取得から始めます');
    }
    var burst = 0;

    function iterate() {
      if (self.aborted) return Promise.resolve();

      if (self.clock.now() - startedAt > deadlineMs) {
        self._log('err', '制限時間（' + Math.round(deadlineMs / 1000) + '秒）を過ぎたため終了します');
        self._setState('failed', { reason: 'timeout' });
        return Promise.resolve();
      }
      if (self.requests >= MAX_REQUESTS) {
        self._log('err', 'リクエスト上限（' + MAX_REQUESTS + '回）に達したため終了します');
        self._setState('failed', { reason: 'request_limit' });
        return Promise.resolve();
      }

      self.attempts++;
      var cycleStart = self.clock.now();

      /* --- 発売の瞬間の一撃 --- */
      if (holdFirst) {
        holdFirst = false;
        var want = plan.candidates[0];
        if (want) {
          self._log('info', '座席表を待たずに ' + want.seats.join(' / ') + ' の確保を試みます');
          self._mark('確保リクエスト送信');
          return self._call(self.adapter.hold, want.seats).then(function (h) {
            self._mark('確保レスポンス受信');
            if (self.aborted) return 'stop';
            if (h && h.ok) return self._succeed(h, { cand: want, rank: 1 });
            var reason = h ? h.reason : 'unknown';
            if (reason === 'not_on_sale' && burst < BURST_MAX) {
              /* 時計のズレで撃つのが早すぎた。ごく短い間隔で撃ち直す。 */
              burst++;
              holdFirst = true;
              self._log('warn', 'まだ発売前でした（時計のズレ）。' + BURST_MS + 'ms 後に撃ち直します（' +
                burst + '/' + BURST_MAX + '）');
              return self.clock.sleep(BURST_MS).then(iterate).then(function () { return 'stop'; });
            }
            self._logHoldFailure(reason, h);
            return null;
          }).then(function (r2) {
            if (r2 === 'done' || r2 === 'stop' || self.aborted) return;
            return self.clock.sleep(Math.max(0, pollMs - (self.clock.now() - cycleStart))).then(iterate);
          });
        }
      }

      return self._call(self.adapter.fetchSeatMap).then(function (r) {
        if (self.aborted || !r || !r.ok) return;
        self.seatMap = r.seats;
        var free = 0;
        for (var k in r.seats) if (r.seats[k] === 'available') free++;
        self._log('dim', '座席状況を取得（空席 ' + free + '席） 試行#' + self.attempts);
        self.onState('hunting', { seatMap: r.seats, attempt: self.attempts });

        /* 優先順位の高い候補から順に見る */
        var target = null;
        for (var i = 0; i < plan.candidates.length; i++) {
          var c = plan.candidates[i];
          var busy = blockingSeats(r.seats, c.seats);
          var sig = busy.join(',');
          if (busy.length === 0) {
            if (self._lastBlocked[c.id]) {
              self._log('info', '第' + (i + 1) + '候補 ' + c.seats.join(' / ') + ' が空きました');
            }
            self._lastBlocked[c.id] = '';
            target = { cand: c, rank: i + 1 };
            break;
          }
          if (self._lastBlocked[c.id] !== sig) {
            self._lastBlocked[c.id] = sig;
            self._log('dim', '第' + (i + 1) + '候補 ' + c.seats.join(' / ') +
              ' … ' + busy.join(' / ') + ' が確保できません');
          }
        }

        /* 全候補が埋まっていて、最終手段が有効なら空席から人気順に拾う */
        if (!target && plan.strategy && plan.strategy.fallbackAny) {
          var alt = self._pickFallback(r.seats);
          if (alt) {
            target = { cand: { id: 'fallback', label: '自動補完', seats: alt }, rank: 0 };
            self._log('warn', '全候補が埋まったため、空席から自動選択します: ' + alt.join(' / '));
          }
        }

        if (!target) {
          if (self.attempts % 10 === 0) {
            self._log('info', '空きを待っています（試行#' + self.attempts + ' / 空席 ' + free + '席）');
          }
          return null;
        }

        var label = target.rank ? '指定席' : '自動選択席';
        self._log('info', label + ' ' + target.cand.seats.join(' / ') + ' を確保します');
        self._mark('確保リクエスト送信');
        return self._call(self.adapter.hold, target.cand.seats).then(function (h) {
          self._mark('確保レスポンス受信');
          if (self.aborted) return;
          if (h && h.ok) return self._succeed(h, target);
          self._logHoldFailure(h ? h.reason : 'unknown', h);
          self.triedCandidates.push(target.cand.id);
          return null;
        });
      }).then(function (done) {
        if (done === 'done' || self.aborted) return;
        /* レート制限：1周期が pollMs 未満なら残りを待つ */
        var spent = self.clock.now() - cycleStart;
        var wait = Math.max(0, pollMs - spent);
        return self.clock.sleep(wait).then(iterate);
      });
    }

    return iterate();
  };

  /**
   * 最終手段。空席の中から人気度の高い連席を拾う。
   * 人数分が横に並んでいることを条件にする（バラけた席は返さない）。
   */
  Runner.prototype._pickFallback = function (seatMap) {
    var need = this.plan.count || 1;
    var screen = this.adapter.screen;
    var seats = this.adapter.seats;
    if (!screen || !seats) return null;

    var byRow = {};
    seats.forEach(function (s) { (byRow[s.row] = byRow[s.row] || []).push(s); });

    var best = null, bestScore = -1;
    var CE = window.CinemaEngine;
    Object.keys(byRow).forEach(function (rowLabel) {
      var list = byRow[rowLabel].slice().sort(function (a, b) { return a.num - b.num; });
      for (var i = 0; i + need <= list.length; i++) {
        var group = list.slice(i, i + need);
        /* 連番であること & 全席空いていること */
        var ok = true, score = 0;
        for (var j = 0; j < group.length; j++) {
          if (j > 0 && group[j].num !== group[j - 1].num + 1) { ok = false; break; }
          if (!CE.isSelectable(group[j])) { ok = false; break; }
          if (seatMap[group[j].id] !== 'available') { ok = false; break; }
          score += CE.popularity(group[j], screen);
        }
        if (!ok) continue;
        score /= need;
        if (score > bestScore) { bestScore = score; best = group.map(function (s) { return s.id; }); }
      }
    });
    return best;
  };

  window.CinemaRunner = { Runner: Runner, Clock: Clock, MIN_POLL_MS: MIN_POLL_MS, MAX_REQUESTS: MAX_REQUESTS };
})();
