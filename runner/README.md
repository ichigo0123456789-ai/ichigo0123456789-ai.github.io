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

## 構成

| ファイル | 役割 |
|---|---|
| `lib/http.js` | プロキシ対応の HTTP（CONNECT トンネル）＋ Cookie ジャー |
| `lib/kinezo.js` | KINEZO アダプタ本体。`init/fetchSchedule/openShow/fetchSeatMap/login/hold` |
| `config.js` | 認証情報をローカルからのみ読む（値は出力しない） |
| `probe.js` | 動作確認 CLI（認証不要） |
| `reserve.js` | 予約オーケストレータ（ログイン→席確保→停止） |
| `.env.example` | 認証情報ファイルの雛形（コピーして `.env` に） |

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
