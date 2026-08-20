#!/usr/bin/env node
/* ============================================================
   自動同期（クラウド → 手元）
   ------------------------------------------------------------
   一定間隔で git pull --ff-only を実行し、クラウド側（Claude）が
   push した変更を手元に自動で取り込む。VSCode でこのフォルダを
   開くと .vscode/tasks.json から自動起動する。VSCode を閉じれば止まる。

   手元でファイルを編集して未コミットの変更があるときは、
   ff-only が失敗して取り込みをスキップする（上書きしない）。
   その場合はコミット/退避してから再開すればよい。
   ============================================================ */
'use strict';
const { execSync } = require('child_process');

var INTERVAL_MS = 15000;

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function now() { return new Date().toTimeString().slice(0, 8); }

function tick() {
  try {
    var before = sh('git rev-parse HEAD');
    sh('git fetch origin --quiet');
    var branch = sh('git rev-parse --abbrev-ref HEAD');
    var behind = sh('git rev-list --count HEAD..origin/' + branch + ' 2>/dev/null || echo 0');
    if (parseInt(behind, 10) > 0) {
      try {
        sh('git pull --ff-only --quiet');
        var after = sh('git rev-parse HEAD');
        if (before !== after) {
          var files = sh('git diff --name-only ' + before + ' ' + after);
          console.log('[' + now() + '] 同期しました（' + behind + '件）:');
          files.split('\n').forEach(function (f) { if (f) console.log('   ' + f); });
        }
      } catch (e) {
        console.log('[' + now() + '] 手元に未コミットの変更があるため同期を保留しました。' +
          'コミットするか変更を戻すと再開します。');
      }
    }
  } catch (e) {
    /* ネットワーク断などは黙ってスキップ（次回リトライ） */
  }
}

console.log('自動同期を開始しました（' + (INTERVAL_MS / 1000) + '秒ごとに確認）。VSCode を閉じると止まります。');
tick();
setInterval(tick, INTERVAL_MS);
