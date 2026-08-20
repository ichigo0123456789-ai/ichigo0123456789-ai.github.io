/* ============================================================
   認証情報のローカル読み込み
   ------------------------------------------------------------
   認証情報は「手元だけ」で管理する。クラウド(Claude)には渡らない。
   優先順位:
     1) 環境変数 KINEZO_EMAIL / KINEZO_PASSWORD
     2) runner/.env（KEY=VALUE 形式。.gitignore 済み＝コミットされない）
   ここで読んだ値は decode して返すだけで、絶対にログ出力しない。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

function fromEnvFile(file) {
  var out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) return;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

/** 認証情報を返す { email, password }。無ければ分かりやすいエラー。 */
function loadCreds() {
  var email = process.env.KINEZO_EMAIL;
  var password = process.env.KINEZO_PASSWORD;
  if (!email || !password) {
    var envFile = fromEnvFile(path.join(__dirname, '.env'));
    email = email || envFile.KINEZO_EMAIL;
    password = password || envFile.KINEZO_PASSWORD;
  }
  if (!email || !password) {
    throw new Error(
      '認証情報が見つかりません。次のいずれかで設定してください:\n' +
      '  1) 環境変数: KINEZO_EMAIL と KINEZO_PASSWORD\n' +
      '  2) runner/.env に KINEZO_EMAIL=... / KINEZO_PASSWORD=...（このファイルは git 管理外）\n' +
      '  ※ 認証情報はコミットもクラウド送信もされません。'
    );
  }
  return { email: email, password: password };
}

module.exports = { loadCreds };
