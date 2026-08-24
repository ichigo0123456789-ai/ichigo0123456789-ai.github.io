/* ============================================================
   金財試験 過去問道場 成績同期サーバー（Google Apps Script）
   セットアップ手順は同じフォルダの SETUP.md を参照。
   スプレッドシートに紐づくスクリプトとして貼り付けて使う。
   データは「users」シートに1ユーザー1行で保存される。
   ============================================================ */

var SHEET_NAME = "users";
var CHUNK = 45000;      // 1セルの上限(5万文字)より少し小さく分割
var MAX_FAIL = 5;       // PIN連続失敗の上限
var LOCK_SEC = 600;     // 失敗上限に達したときのロック時間（秒）

function doGet() {
  return json_({ ok: true, service: "kinzai-dojo-sync" });
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    res = handle_(req);
  } catch (err) {
    res = { ok: false, error: "bad_request" };
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var action = String(req.action || "");
  var id = String(req.id || "").trim();
  var pin = String(req.pin || "").trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(id)) return { ok: false, error: "bad_id" };
  if (!/^[0-9]{4}$/.test(pin)) return { ok: false, error: "bad_pin" };

  // PIN総当たり対策：連続失敗でしばらくロック
  var cache = CacheService.getScriptCache();
  var failKey = "fail_" + id.toLowerCase();
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAIL) return { ok: false, error: "locked" };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var rowIdx = findRow_(sheet, id);

    if (action === "register") {
      if (rowIdx !== -1) return { ok: false, error: "id_taken" };
      var salt = Utilities.getUuid();
      var now = new Date().toISOString();
      var hist = (req.hist && typeof req.hist === "object") ? req.hist : {};
      var row = [id, salt, hashPin_(salt, pin), now, now].concat(chunk_(JSON.stringify(hist)));
      sheet.appendRow(row);
      return { ok: true, hist: hist };
    }

    if (rowIdx === -1) { bumpFail_(cache, failKey, fails); return { ok: false, error: "not_found" }; }

    var width = Math.max(sheet.getLastColumn(), 5);
    var row2 = sheet.getRange(rowIdx, 1, 1, width).getValues()[0];
    if (hashPin_(String(row2[1]), pin) !== String(row2[2])) {
      bumpFail_(cache, failKey, fails);
      return { ok: false, error: "wrong_pin" };
    }
    cache.remove(failKey);

    var serverHist = parseHist_(row2.slice(5));

    if (action === "login") return { ok: true, hist: serverHist };

    if (action === "sync") {
      var clientHist = (req.hist && typeof req.hist === "object") ? req.hist : {};
      var merged = mergeHist_(serverHist, clientHist);
      writeHist_(sheet, rowIdx, merged);
      return { ok: true, hist: merged };
    }

    return { ok: false, error: "bad_action" };
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["id", "salt", "pinHash", "createdAt", "updatedAt", "hist1"]);
  }
  return sheet;
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  var key = id.toLowerCase();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toLowerCase() === key) return i + 2;
  }
  return -1;
}

function hashPin_(salt, pin) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ":" + pin, Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    hex += ("0" + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  }
  return hex;
}

function bumpFail_(cache, key, fails) {
  cache.put(key, String(fails + 1), LOCK_SEC);
}

function chunk_(str) {
  var out = [];
  for (var i = 0; i < str.length; i += CHUNK) out.push(str.slice(i, i + CHUNK));
  return out.length ? out : [""];
}

function parseHist_(cells) {
  var str = "";
  for (var i = 0; i < cells.length; i++) str += (cells[i] == null ? "" : String(cells[i]));
  if (!str) return {};
  try {
    var h = JSON.parse(str);
    return (h && typeof h === "object") ? h : {};
  } catch (e) { return {}; }
}

function writeHist_(sheet, rowIdx, hist) {
  var chunks = chunk_(JSON.stringify(hist));
  // 以前の書き込みが長かった場合の残りセルも空文字で上書きして消す
  var width = Math.max(sheet.getLastColumn() - 5, chunks.length);
  var values = [];
  for (var i = 0; i < width; i++) values.push(chunks[i] || "");
  sheet.getRange(rowIdx, 5).setValue(new Date().toISOString());
  sheet.getRange(rowIdx, 6, 1, width).setValues([values]);
}

// 履歴のマージ：問題ごとに解答数(c+w)が多い側を採用、チェック(mark)はOR。
// 同じデータ同士なら結果が変わらないため、繰り返し実行しても安全。
function mergeHist_(base, add) {
  var out = {};
  var k;
  for (k in base) if (base.hasOwnProperty(k)) out[k] = pick_(base[k], add[k]);
  for (k in add) if (add.hasOwnProperty(k) && !out.hasOwnProperty(k)) out[k] = pick_(base[k], add[k]);
  return out;
}

function pick_(x, y) {
  if (!x || !y) {
    var p0 = x || y;
    return { c: p0.c || 0, w: p0.w || 0, last: p0.last || null, mark: !!p0.mark };
  }
  var p = ((y.c || 0) + (y.w || 0)) >= ((x.c || 0) + (x.w || 0)) ? y : x;
  return { c: p.c || 0, w: p.w || 0, last: p.last || null, mark: !!(x.mark || y.mark) };
}
