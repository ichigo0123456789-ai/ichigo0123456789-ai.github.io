/* ============================================================
   認証情報のローカル読み込み（チェーン別）
   ------------------------------------------------------------
   認証情報は「手元だけ」で管理する。クラウド(Claude)には渡らない。
   チェーン（KINEZO / 109 …）ごとに変数名を分け、混用しない。
   優先順位:
     1) 環境変数
     2) runner/.env（KEY=VALUE 形式。.gitignore 済み＝コミットされない）
   ここで読んだ値は返すだけで、絶対にログ出力しない。
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

/* チェーンごとの環境変数名。劇場チェーンが増えたらここに1行足す。 */
var CHAIN_VARS = {
  kinezo: { user: 'KINEZO_EMAIL', pass: 'KINEZO_PASSWORD', label: 'KINEZO（T・ジョイ系）会員のメール/パスワード' },
  '109':  { user: 'C109_ID',      pass: 'C109_PASSWORD',   label: '109シネマズ シネマポイント会員の ID(メール/会員番号)/パスワード' }
};

/** 指定チェーンの認証情報を返す { email, password, chain }。無ければ分かりやすいエラー。 */
function loadCreds(chain) {
  chain = chain || 'kinezo';
  var v = CHAIN_VARS[chain];
  if (!v) throw new Error('未知のチェーンです: ' + chain + '（対応: ' + Object.keys(CHAIN_VARS).join(', ') + '）');
  var user = process.env[v.user];
  var pass = process.env[v.pass];
  if (!user || !pass) {
    var f = fromEnvFile(path.join(__dirname, '.env'));
    user = user || f[v.user];
    pass = pass || f[v.pass];
  }
  if (!user || !pass) {
    throw new Error(
      '認証情報が見つかりません（' + v.label + '）。次のいずれかで設定してください:\n' +
      '  1) 環境変数: ' + v.user + ' と ' + v.pass + '\n' +
      '  2) runner/.env に ' + v.user + '=... / ' + v.pass + '=...（このファイルは git 管理外）\n' +
      '  ※ 認証情報はコミットもクラウド送信もされません。'
    );
  }
  return { email: user, password: pass, chain: chain };
}

module.exports = { loadCreds, CHAIN_VARS };
