# KINEZO ローカル runner（Phase 2）

映画予約プランナー（`/cinema/`）の Phase 2。実際の KINEZO サイトに接続して
上映スケジュール・座席状況を取得する Node モジュール。

`cinema/` の静的サイトが「プランを組む場所」なのに対し、こちらは
「実際に KINEZO を読む実行体」。手元PC でもクラウドセッションでも動く。

## 現状（認証不要の範囲まで実装済み）

| メソッド | 状態 | 内容 |
|---|---|---|
| `init()` | ✅ | 劇場トップから CSRF・セッション確立 |
| `fetchSchedule(date)` | ✅ | その日の**実番組表**（作品・時刻・スクリーン・上映時間） |
| `openShow(show)` | ✅ | 予約フロー入口 → 座席選択画面（**ログイン不要で到達**） |
| `fetchSeatMap()` | ✅ | 座席選択画面から**実際の空席/売切**を読む |
| `login()` | ⬜ 未 | 認証が必要。権限を開いてから Phase 2b |
| `hold(seatIds)` | ⬜ 未 | ログイン後の座席確保。Phase 2b |

`login` / `hold` を未実装にしているのは、認証情報を扱う操作がこのセッションの
安全ガードでブロックされているため。座席状況の取得までは認証不要で完結する。

## 使い方

```bash
# 今日の番組表
node runner/probe.js

# 指定日 + 座席状況
node runner/probe.js 2026-08-25 seats

# クラウド/プロキシ環境では CA を指定
NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node runner/probe.js
```

## 構成

| ファイル | 役割 |
|---|---|
| `lib/http.js` | プロキシ対応の HTTP（CONNECT トンネル）＋ Cookie ジャー |
| `lib/kinezo.js` | KINEZO アダプタ本体。実サイトのパース |
| `probe.js` | 動作確認 CLI |

実サイトの仕様（API・URL・DOM）は `cinema/KINEZO-RESEARCH.md` を参照。

## `cinema/` との接続（今後）

`cinema/engine.js` のアダプタ境界（`open`/`fetchSeatMap`/`hold`/`release`）と
同じ形にしてあるので、`cinema/` のモックアダプタをこの実接続版に差し替えれば、
リハーサルと同じ確保ロジック（`runner.js`）がそのまま実サイトで動く。

## 安全のための制約

- 認証情報はこのコードに一切書かない。Phase 2b では Drive の非公開ファイルから
  実行時に読む（値はログ・コミットに出さない）。
- リクエストは人間ペース。スケジュール/座席の取得を短時間に連打しない。
- 実際の予約確定（決済）は自動化しない。確保後は人間が KINEZO で購入する。
- 発売時の仮想待合室には正直に並ぶ（列のスキップ・多重接続はしない）。
