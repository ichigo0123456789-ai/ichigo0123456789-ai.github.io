# KINEZO ローカル runner（Phase 2）

映画予約プランナー（`/cinema/`）の Phase 2。実際の KINEZO サイトに接続して
上映スケジュール・座席状況を取得する Node モジュール。

`cinema/` の静的サイトが「プランを組む場所」なのに対し、こちらは
「実際に KINEZO を読む実行体」。手元PC でもクラウドセッションでも動く。

## 現状

| メソッド | 状態 | 内容 |
|---|---|---|
| `init()` | ✅ | 劇場トップから CSRF・セッション確立 |
| `fetchSchedule(date)` | ✅ | その日の**実番組表**（作品・時刻・スクリーン・上映時間） |
| `openShow(show)` | ✅ | 予約フロー入口 → 座席選択画面（**ログイン不要で到達**） |
| `fetchSeatMap()` | ✅ | 座席選択画面から**実際の空席/売切**を読む |
| `login(email,pw)` | ✅ 実装済（要 手元実機確認） | 会員ログイン（`/login` に POST。CAPTCHAなし） |
| `hold(seatIds)` | ✅ 実装済（要 手元実機確認） | `choiceSeatSave` で**席を仮確保**→券種選択画面で停止 |
| `releaseHold()` | ✅ | 掴んだ席を解放 |

> `login`/`hold` の実フローは公開ページの解析で特定済み（`cinema/KINEZO-RESEARCH.md` §6,§7）。
> ただし**実際の会員ログインを伴う検証は手元PCで実行者が行う**（認証情報はクラウド＝Claude 側に渡さない設計）。
> まずは `--login-only` と `--dry` で安全に確認してください。

## 使い方

### 動作確認（認証不要）
```bash
node runner/probe.js 2026-08-21          # 指定日の番組表
node runner/probe.js 2026-08-21 seats    # 先頭上映回の空席数も
```

### 認証情報の設定（手元だけ）
```bash
cp runner/.env.example runner/.env       # .env は git 管理外
# runner/.env に会員メール/パスワードを記入（または環境変数 KINEZO_EMAIL / KINEZO_PASSWORD）
```

### 予約（手元PCで実行）
```bash
node runner/reserve.js --login-only                                  # ①ログイン確認だけ
node runner/reserve.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-2,A-3 --dry                                 # ②予行演習（確保しない）
node runner/reserve.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-2,A-3                                       # ③今すぐ確保
node runner/reserve.js --date 2026-08-27 --title ユーフォニアム \
  --time 10:00 --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"    # ④発売時刻に確保（待機）
```

`--at` を使うと発売時刻まで待って確保します＝**発売前にPCで起動しておく運用**。
席の確保（仮予約）まで自動、**券種選択・決済は人間がブラウザで完了**します。

> ⚠️ **純Node版（reserve.js）の制約**：仮予約は実行時のログインセッションに紐づくため、
> 掴んだ席は**別ブラウザに引き継げません**（choice_ticket のURLを貼っても
> 「アクセスに失敗しました」。マイページにも出ません）。実機で確認済み。
> **決済まで人間が続けたい場合は下の可視ブラウザ版を使ってください。**

### 予約（可視ブラウザ版 = 推奨）`reserve-browser.js`

実ブラウザを1枚立ち上げ、ログイン→席確保まで自動 → **同じウィンドウを開いたまま**にする。
決済はその同じセッションで人間が続けるので、引き継ぎ問題が起きない。

```bash
# 初回だけ Playwright を導入
cd runner && npm install && npx playwright install chromium && cd ..

node runner/reserve-browser.js --login-only                          # ①ログイン確認
node runner/reserve-browser.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-3 --dry                                     # ②予行演習（確保しない）
node runner/reserve-browser.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-3                                           # ③確保→開いたまま決済
node runner/reserve-browser.js --date 2026-08-27 --title ユーフォニアム \
  --time 10:00 --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"    # ④発売時刻に確保
```

### 予約（ハイブリッド版 = 最速）`reserve-hybrid.js`

**確保は純HTTPで直POST（サブ秒。ブラウザもスクリプトも読まない）**→ その確保済み
セッションの Cookie を実ブラウザに注入して、**決済は人間が同一セッションで続ける**。
発売0秒の争奪戦向け。Playwright は決済ウィンドウ用に必要。

```bash
cd runner && npm install && npx playwright install chromium && cd ..

node runner/reserve-hybrid.js --login-only
node runner/reserve-hybrid.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-3 --dry
node runner/reserve-hybrid.js --date 2026-08-21 --title オークストリート \
  --time 15:00 --seats A-3
node runner/reserve-hybrid.js --date 2026-08-27 --title ユーフォニアム \
  --time 10:00 --seats G-10,G-11 --at "2026-08-25T00:00:00+09:00"
```

速度比較（目安）:

| 方式 | 確保までの速さ | 決済引き継ぎ |
|---|---|---|
| `reserve.js`（純Node） | 最速（サブ秒） | ❌ 別ブラウザに渡せない |
| `reserve-browser.js`（可視ブラウザ） | 遅い（ページ読込 ~11秒） | ✅ 同一ウィンドウ |
| **`reserve-hybrid.js`** | **最速（サブ秒）** | **✅ Cookie注入で同一セッション** |

## 構成

| ファイル | 役割 |
|---|---|
| `lib/http.js` | プロキシ対応の HTTP（CONNECT トンネル）＋ Cookie ジャー |
| `lib/kinezo.js` | KINEZO アダプタ本体。`init/fetchSchedule/openShow/fetchSeatMap/login/hold` |
| `config.js` | 認証情報をローカルからのみ読む（値は出力しない） |
| `probe.js` | 動作確認 CLI（認証不要） |
| `reserve.js` | 予約オーケストレータ・純Node版（席確保まで。決済引き継ぎ不可） |
| `reserve-browser.js` | 予約・可視ブラウザ版（Playwright）。決済まで人間が同一画面で続けられる |
| `reserve-hybrid.js` | 予約・ハイブリッド版。**サブ秒確保＋Cookie注入で決済＝最速・推奨** |
| `package.json` | Playwright 依存（`cd runner && npm install`） |
| `.env.example` | 認証情報ファイルの雛形（コピーして `.env` に） |

## 対応劇場（`--theater`）

KINEZO 系の劇場は `--theater <key>` で切り替えます（既定は `yokohama`）。同じ KINEZO なので、ログイン・座席取得・確保は共通です。

| key | 劇場 | 備考 |
|---|---|---|
| `yokohama` | T・ジョイ横浜 | 既定。9スクリーン・1,212席 |
| `wald9` | 新宿バルト9 | 9スクリーン・1,807席（実データ 2026-08-23） |
| `kyoto` | T・ジョイ京都 | 12スクリーン・2,117席（実データ 2026-08-23） |
| `umeda` | T・ジョイ梅田 | 7スクリーン・1,390席（実データ 2026-08-23） |
| `burg13` | 横浜ブルク13 | 12スクリーン・2,246席（実データ 2026-08-23） |
| `kawasaki` | 109シネマズ川崎 | **109シネマズ（別システム・`lib/k109.js`）**。10スクリーン・1,838席（実データ 2026-08-23） |
| `premium_shinjuku` | 109シネマズプレミアム新宿 | 109シネマズ。7スクリーン・670席（プレミアム席/一般席の別売りを統合） |
| `toho_shinjuku` 12scr/2,302席 · `toho_hibiya` 13scr/2,698席 · `toho_shibuya` 6scr/1,224席 · `toho_roppongi` 9scr/1,837席 · `toho_ikebukuro` 10scr/1,717席 · `toho_kawasaki` 9scr/1,859席 | TOHOシネマズ 主要館 | **TOHO（vit・`lib/toho.js`）**。ログインなしの「ゲスト購入」経路で座席指定まで自動。座席レイアウト登録済み（実データ 2026-08-23）。`toho_lalaport_yokohama`(036) は 8/20〜8/27 休館中のため未採取（runner からはコード指定で使える） |
| `toho<劇場コード3桁>`（例 `toho080`＝上野） | TOHOシネマズ 全73館 | runner はコード指定で全館対応（`runner/data/toho-theaters.json`）。サイトに座席表を出すには `add-theater.js <code> <key> ... --chain toho` で採取 |

```bash
node runner/reserve-hybrid.js --theater wald9 --date 2026-08-24 --title 作品名 --time 18:00 --seats "H-10,H-11"
```

サイト（`cinema/`）で劇場を選んでコマンド生成すると `--theater` が自動で付きます（各劇場の `runnerKey`）。

**認証情報はチェーンごとに別**です（`runner/.env.example` 参照）：T・ジョイ系は `KINEZO_EMAIL` / `KINEZO_PASSWORD`、109シネマズは `C109_ID` / `C109_PASSWORD`、TOHO は任意（未設定ならゲスト購入。TOHO-ONE ログインの自動化は未対応）。runner は `--theater` のチェーンに合わせて自動で使い分け、混用しません。

**劇場追加は `node runner/add-theater.js <spec> <key> "<名前>" "<エリア>" "<都道府県>" [--chain kinezo|109|toho]` で自動**（実サイトから全スクリーンの座席を採取し、theaters.js / runner を一括更新。KINEZO は劇場パス、109 はサイト別名（例 `I1`）を spec に渡す）。
未対応：チネチッタ川崎 / グランドシネマサンシャイン池袋 / 新文芸坐（順次、別アダプタで対応予定）。

## 第2候補席の自動フォールバック

`reserve-hybrid.js` の `--seats` は `/` 区切りで**優先グループ**を指定できます（各グループはカンマ区切りの席＝人数分）。第1候補が埋まっていれば第2候補…と**自動で次点を確保**します。競合で確保に失敗した場合も座席表を取り直して次候補を試します。

```bash
node runner/reserve-hybrid.js --date 2026-08-27 --title ユーフォニアム --time 10:00 \
  --seats "G-10,G-11 / F-10,F-11 / H-8,H-9" --at "2026-08-25T00:00:00+09:00"
```
単一グループ（例 `--seats A-3`）は従来どおり動作します。

## 待機列（混雑時）対応

`reserve-hybrid.js` は発売直後に座席画面へ到達できない場合、画面種別を判定して
分岐します（`Kinezo.pageKind`）：混雑/順番待ちなら**単一接続で正直に待って**解放と
同時に掴む、CAPTCHA・想定外画面なら**停止して人間に引き継ぐ**。**多重接続・列の
追い越しはしません**。各チェーンの待機列方式と「会員先行が最速」等の戦略は
`cinema/QUEUE-RESEARCH.md` を参照。

実サイトの仕様（API・URL・DOM）は `cinema/KINEZO-RESEARCH.md` を参照。

## `cinema/` との接続（今後）

`cinema/engine.js` のアダプタ境界（`open`/`fetchSeatMap`/`hold`/`release`）と
同じ形にしてあるので、`cinema/` のモックアダプタをこの実接続版に差し替えれば、
リハーサルと同じ確保ロジック（`runner.js`）がそのまま実サイトで動く。

## 安全のための制約

- 認証情報はこのコードに一切書かない。実行時に手元の環境変数／`runner/.env`
  （git 管理外）から読む。値はログ・コミット・クラウド送信に出さない。
- リクエストは人間ペース。スケジュール/座席の取得を短時間に連打しない。
- 実際の予約確定（決済）は自動化しない。確保後は人間が KINEZO で購入する。
- 発売時の仮想待合室には正直に並ぶ（列のスキップ・多重接続はしない）。
