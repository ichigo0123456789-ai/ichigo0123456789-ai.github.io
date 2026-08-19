/* ============================================================
   予約ランナー（チェーン非依存のオーケストレーション）
   ------------------------------------------------------------
   「発売時刻を待つ → 座席状況を取る → 優先順位の高い候補から確保を試す
     → 負けたら次の候補へ」というループ本体。
   アダプタ（engine.js の MockAdapter / Phase 2 の実サイトアダプタ）と
   時計（Clock）にしか依存しないので、Phase 2 ではそのまま流用できる。

   ■ レート制限について
   ポーリング間隔には MIN_POLL_MS の下限を強制している。相手サイトへの
   連打は規約違反であり、そもそも弾かれて成功率も下がる。UI 側で
   これより短い値を入れても、ここで切り上げてログに残す。
   ============================================================ */

(function () {
  'use strict';

  var MIN_POLL_MS = 500;      /* これ以上速くポーリングしない（ハード下限） */
  var MAX_REQUESTS = 400;     /* 1回の実行で出すリクエストの総数上限 */

  /* ---- 時計 --------------------------------------------------------
     speed > 1 で早送り。リハーサルで「発売の瞬間」を待たずに検証するため。 */
  function Clock(opts) {
    opts = opts || {};
    this.speed = opts.speed || 1;
    this._base = opts.base != null ? opts.base : Date.now();
    this._start = Date.now();
  }
  Clock.prototype.now = function () {
    return this._base + (Date.now() - this._start) * this.speed;
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

  Runner.prototype.abort = function () {
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
      candidates: plan.candidates.length
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
        return self._call(self.adapter.open).then(function (r) {
          if (r && r.queueSec > 0) {
            self._log('warn', '待機列に入りました（約' + r.queueSec + '秒）');
            return self.clock.sleep(r.queueSec * 1000);
          }
        });
      })
      /* --- 3. 発売の瞬間まで残りを待つ --- */
      .then(function () {
        if (self.aborted) return;
        var remain = plan.onSaleAt - self.clock.now();
        if (remain > 0) {
          self._log('info', '発売開始まであと ' + (remain / 1000).toFixed(1) + '秒');
          return self.clock.sleep(remain);
        }
      })
      /* --- 4. 確保ループ --- */
      .then(function () {
        if (self.aborted) return;
        self._setState('hunting');
        self._log('ok', '発売開始。座席の確保を開始します');
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

  Runner.prototype._huntLoop = function (startedAt, deadlineMs, pollMs) {
    var self = this;
    var plan = this.plan;

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

        var label = target.rank ? '第' + target.rank + '候補' : '自動選択席';
        self._log('info', label + ' ' + target.cand.seats.join(' / ') + ' を確保します');
        return self._call(self.adapter.hold, target.cand.seats).then(function (h) {
          if (self.aborted) return;
          if (h && h.ok) {
            self.result = {
              seats: h.seats,
              rank: target.rank,
              heldAt: self.clock.now(),
              holdExpiresAt: h.holdExpiresAt,
              elapsedSec: (self.clock.now() - plan.onSaleAt) / 1000
            };
            self._log('ok', '確保しました: ' + h.seats.join(' / ') +
              '（発売開始から ' + self.result.elapsedSec.toFixed(1) + '秒）');
            self._setState('held', self.result);
            return 'done';
          }
          var reason = h ? h.reason : 'unknown';
          if (reason === 'race_lost') {
            self._log('err', (h.seat || '') + ' を他のユーザーに先に取られました。次の候補へ移ります');
          } else if (reason === 'taken') {
            self._log('err', (h.seat || '') + ' は既に売切です。次の候補へ移ります');
          } else if (reason === 'not_on_sale') {
            self._log('warn', 'まだ発売開始前でした。少し待って再試行します');
          } else {
            self._log('err', '確保に失敗しました（' + reason + '）');
          }
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
