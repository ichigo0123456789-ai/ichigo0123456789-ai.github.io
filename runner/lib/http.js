/* ============================================================
   HTTP ヘルパー（プロキシ対応）
   ------------------------------------------------------------
   手元PCではプロキシなしで tjoy.jp に直結。
   クラウド/企業プロキシ環境では HTTPS_PROXY 経由（CONNECT トンネル）。
   Node は HTTPS_PROXY を自動では見ないので自前でトンネルを張る。
   Cookie を保持し、KINEZO のセッション（CSRF・待機列）を維持する。
   ============================================================ */

'use strict';

const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

/** 簡易 Cookie ジャー（ドメイン無視の単純版。単一サイト用途なので十分） */
class CookieJar {
  constructor() { this.jar = {}; }
  setFrom(res) {
    var sc = res.headers['set-cookie'];
    if (!sc) return;
    sc.forEach((line) => {
      var kv = line.split(';')[0];
      var i = kv.indexOf('=');
      if (i > 0) this.jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
  }
  header() {
    return Object.keys(this.jar).map((k) => k + '=' + this.jar[k]).join('; ');
  }
  /** Playwright の addCookies 形式に変換（同一サイト用途なので url を付ける） */
  toPlaywrightCookies(url) {
    var jar = this.jar;
    return Object.keys(jar).map(function (name) { return { name: name, value: jar[name], url: url }; });
  }
}

/** プロキシ環境なら CONNECT トンネルの socket を、なければ null（直結）を返す */
function connectSocket(host, port) {
  var proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return Promise.resolve(null);
  var p = new URL(proxy);
  return new Promise((resolve, reject) => {
    var sock = net.connect(parseInt(p.port, 10) || 8080, p.hostname, () => {
      sock.write('CONNECT ' + host + ':' + port + ' HTTP/1.1\r\n' +
                 'Host: ' + host + ':' + port + '\r\n\r\n');
    });
    var buf = '';
    function onData(chunk) {
      buf += chunk.toString('latin1');
      if (buf.indexOf('\r\n\r\n') >= 0) {
        sock.removeListener('data', onData);
        if (/^HTTP\/1\.[01] 200/.test(buf)) resolve(sock);
        else { sock.destroy(); reject(new Error('プロキシ CONNECT 失敗: ' + buf.split('\r\n')[0])); }
      }
    }
    sock.on('data', onData);
    sock.on('error', reject);
    sock.setTimeout(15000, () => { sock.destroy(new Error('CONNECT timeout')); });
  });
}

/**
 * リクエストを送る。
 * @param opt { method, url, headers, body, jar, followRedirect }
 * @returns { status, headers, body, url }
 */
async function request(opt) {
  var url = new URL(opt.url);
  var jar = opt.jar;
  var headers = Object.assign({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9'
  }, opt.headers || {});
  if (jar && jar.header()) headers['Cookie'] = jar.header();
  if (opt.body != null) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(opt.body);
  }

  var isHttps = url.protocol === 'https:';
  var port = url.port || (isHttps ? 443 : 80);
  var socket = isHttps ? await connectSocket(url.hostname, port) : null;

  var res = await new Promise((resolve, reject) => {
    var reqOpts = {
      method: opt.method || 'GET',
      host: url.hostname,
      port: port,
      path: url.pathname + url.search,
      headers: headers
    };
    if (socket) { reqOpts.socket = socket; reqOpts.agent = false; reqOpts.servername = url.hostname; }
    var lib = isHttps ? https : http;
    var req = lib.request(reqOpts, (r) => {
      var chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
    if (opt.body != null) req.write(opt.body);
    req.end();
  });

  if (jar) jar.setFrom(res);

  /* リダイレクト追従（KINEZO の reservation/index → choice_seat 用） */
  if (opt.followRedirect !== false && res.status >= 300 && res.status < 400 && res.headers.location) {
    var next = new URL(res.headers.location, url).toString();
    return request(Object.assign({}, opt, { url: next, method: 'GET', body: null }));
  }
  res.url = url.toString();
  return res;
}

module.exports = { request, CookieJar };
