/* ============================================================
   発売開始に最速で到達するための部品
   ------------------------------------------------------------
   「速く取る」の中身は、実際にはほぼ次の3つに分解できる。

     1. サーバ時刻とのズレを消す
        手元の時計が2秒遅れていれば、どれだけ速いコードでも2秒出遅れる。
        体感で最も効くのはここ。
     2. 発売の瞬間ちょうどに発火する
        setTimeout は数十ms〜数百msずれる。背景タブでは1秒以上ずれる。
     3. 発売の瞬間に往復回数を減らす
        座席表を取ってから確保すると、確保が1往復ぶん遅れる。
        欲しい席が決まっているなら、いきなり確保を投げたほうが速い。

   ここでは 1 と 2 を提供する。3 は runner.js の holdFirst で行う。
   ============================================================ */

(function () {
  'use strict';

  /* ---- 1. サーバ時刻との同期 ---------------------------------------

     HTTP の Date ヘッダは秒精度しかないが、
     「オフセットが取りうる区間」を毎回1秒幅で得られると考えれば、
     サンプルを重ねて区間を交差させることでサブ秒まで絞り込める。

       応答生成時のサーバ時刻 S ∈ [D, D+1000)   D = Date ヘッダ
       応答生成時のローカル時刻 ≈ t0 + rtt/2
       offset = S - (t0 + rtt/2)
              ∈ [D - t0 - rtt/2,  D + 1000 - t0 - rtt/2)

     秒境界をまたぐようサンプルを散らすと交差区間が狭くなる。
     ------------------------------------------------------------ */

  function TimeSync() {
    this.offset = 0;          /* サーバ時刻 - ローカル時刻 (ms) */
    this.uncertainty = null;  /* ± ms。null = 未同期 */
    this.rtt = null;
    this.samples = 0;
    this.syncedAt = null;
    this.source = null;
  }

  /** 同期済みの現在時刻 */
  TimeSync.prototype.now = function () {
    return Date.now() + this.offset;
  };

  TimeSync.prototype.reset = function () {
    this.offset = 0; this.uncertainty = null; this.rtt = null;
    this.samples = 0; this.syncedAt = null; this.source = null;
  };

  /**
   * @param url      HEAD を投げる先。同一オリジンなら Date ヘッダを読める。
   * @param opt      {count, spacingMs, onProgress}
   */
  TimeSync.prototype.measure = function (url, opt) {
    opt = opt || {};
    var self = this;
    var count = opt.count || 12;
    var spacing = opt.spacingMs != null ? opt.spacingMs : 130;
    var onProgress = opt.onProgress || function () {};

    var lo = -Infinity, hi = Infinity;
    var bestRtt = Infinity;
    var used = 0;
    var i = 0;

    function step() {
      if (i >= count) return finish();
      i++;
      var t0 = Date.now();
      /* キャッシュに当たると Date が過去のものになる。必ず素通しさせる。 */
      var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + '_ts=' + t0 + '-' + i;
      return fetch(u, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
        var t1 = Date.now();
        var dateHdr = res.headers.get('Date');
        if (!dateHdr) return;
        var D = Date.parse(dateHdr);
        if (isNaN(D)) return;
        var rtt = t1 - t0;
        if (rtt < bestRtt) bestRtt = rtt;
        /* 往復が極端に遅いサンプルは非対称の疑いが強いので捨てる */
        if (bestRtt < Infinity && rtt > bestRtt * 3 + 60) return;

        var mid = t0 + rtt / 2;
        var l = D - mid;
        var h = D + 1000 - mid;
        var nlo = Math.max(lo, l), nhi = Math.min(hi, h);
        if (nlo > nhi) {
          /* 交差が消えた = 途中で時計が動いた等。直近のサンプルで作り直す。 */
          lo = l; hi = h; used = 1;
        } else {
          lo = nlo; hi = nhi; used++;
        }
        onProgress({ done: i, total: count, uncertainty: (hi - lo) / 2, rtt: rtt });
      }).catch(function () {
        /* 1回くらい落ちても続行する */
      }).then(function () {
        return new Promise(function (r) { setTimeout(r, spacing); }).then(step);
      });
    }

    function finish() {
      if (used === 0 || !isFinite(lo) || !isFinite(hi)) {
        self.reset();
        return { ok: false, reason: 'no_date_header' };
      }
      self.offset = Math.round((lo + hi) / 2);
      self.uncertainty = Math.round((hi - lo) / 2);
      self.rtt = Math.round(bestRtt);
      self.samples = used;
      self.syncedAt = Date.now();
      self.source = url;
      return {
        ok: true, offset: self.offset, uncertainty: self.uncertainty,
        rtt: self.rtt, samples: self.samples
      };
    }

    return Promise.resolve().then(step);
  };

  /* ---- 2. 高精度タイマー --------------------------------------------

     setTimeout は指定時刻ぴったりには起きない。
     遠いうちは setTimeout で粗く寄せ、近づいたら刻みを細かくし、
     最後の数十msは MessageChannel で 1ms 未満の粒度まで詰める。
     （ビジーループと違い、メインスレッドを占有しない）
     ------------------------------------------------------------ */

  function PreciseTimer(nowFn) {
    this.now = nowFn || function () { return Date.now(); };
  }

  PreciseTimer.prototype.at = function (targetTime, fn) {
    var self = this;
    var handle = { cancelled: false, timer: null, chan: null };

    function fire() {
      if (handle.cancelled) return;
      handle.cancelled = true;
      fn(self.now() - targetTime);   /* 実際のズレ(ms)を渡す */
    }

    function tick() {
      if (handle.cancelled) return;
      var remain = targetTime - self.now();
      if (remain <= 0) return fire();

      if (remain > 3000) {
        handle.timer = setTimeout(tick, remain - 2000);
      } else if (remain > 60) {
        handle.timer = setTimeout(tick, Math.max(4, remain - 40));
      } else {
        /* 最終区間。MessageChannel は setTimeout(…,0) の 4ms クランプを受けない。 */
        if (!handle.chan) handle.chan = new MessageChannel();
        handle.chan.port1.onmessage = tick;
        handle.chan.port2.postMessage(0);
      }
    }

    tick();

    handle.cancel = function () {
      handle.cancelled = true;
      if (handle.timer) clearTimeout(handle.timer);
      if (handle.chan) handle.chan.port1.onmessage = null;
    };
    return handle;
  };

  /* ---- 背景タブの検出 ------------------------------------------------
     タブが非表示だとタイマーが1秒以上まとめられ、発売の瞬間を外す。
     消せない制約なので、検出して警告する。 */

  function VisibilityWatch(onHidden) {
    this.wasHidden = false;
    var self = this;
    this._h = function () {
      if (document.hidden) { self.wasHidden = true; onHidden(); }
    };
    document.addEventListener('visibilitychange', this._h);
  }
  VisibilityWatch.prototype.stop = function () {
    document.removeEventListener('visibilitychange', this._h);
  };

  /* ---- 3. 計測 --------------------------------------------------------
     速くなったと言い張るのではなく、どこに何msかかったかを残す。 */

  function Timeline(originFn) {
    this.origin = originFn;   /* 相対時刻の基準（発売開始時刻） */
    this.marks = [];
  }
  Timeline.prototype.mark = function (label, at) {
    var t = at != null ? at : this.origin.now();
    var prev = this.marks.length ? this.marks[this.marks.length - 1].t : null;
    this.marks.push({ label: label, t: t, delta: prev != null ? t - prev : 0 });
    return t;
  };
  Timeline.prototype.clear = function () { this.marks = []; };

  window.CinemaSpeed = {
    TimeSync: TimeSync,
    PreciseTimer: PreciseTimer,
    VisibilityWatch: VisibilityWatch,
    Timeline: Timeline
  };
})();
