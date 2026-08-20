# KINEZO 実サイト調査メモ（Phase 2 の設計図）

調査日: **2026-08-20**（T・ジョイ横浜 theaterId=190 で確認）
方法: 認証情報なし・公開ページのみ。座席選択画面まではログイン不要で到達できた。

> ここは「実サイトがどう動くか」の記録。Phase 2 の KINEZO アダプタ
> （`open` / `fetchSeatMap` / `hold` / `release`）をこの仕様に合わせて書く。
> 掲載のID・URLは調査時点の一例で、時間が経てば変わる。

---

## 1. サイトの作り

- サーバサイドレンダリング + jQuery（SPA ではない）。座席表は image-map。
- 主要 JS: `/js/front/common_func.js`（AJAX 定義）、`/js/front/scripts/main.js`
- 各ページに `theaterId`(hidden, 横浜=190)、`csrfToken`(hidden)、`today`/`showDate` を持つ
- POST には `_csrfToken`（`<meta name="csrf-token">` の値）が必須。Cookie セッションあり。

## 2. 上映スケジュール取得（＝番組表の実データ源）

```
POST /theaterTop/scheduleGetHtmlApi
  data = {"date":"YYYY-MM-DD","theaterId":"190"}   (JSON文字列を data= に)
  _csrfToken = <csrf-token>
  → 該当日の全上映回の HTML 断片（約200KB）
```

返る HTML から取れるもの:
- 作品名（`h5.js-title-film`）、原題（隣の `<span>`）、本編分数（`.time-film`）
- 作品コード（`cinema_detail/C4943100` の `C4943100`）
- 上映回ごとに予約フローURL（下記）とスクリーン名、開映〜終映時刻
- 残席レベルはアイコン `icon_label1〜4.png`（◎〜×相当。alt の対応は要精査）、
  「販売終了」「窓口のみ」などのラベルもここに出る

## 3. 予約フロー入口 → 座席選択画面

```
GET /t-joy_yokohama/reservation/index/{showId}/{filmCode}/{screen}/{date}?type=film
  例: /t-joy_yokohama/reservation/index/138553/C4943100/9/2026-08-20?type=film
  → 302 → /t-joy_yokohama/reservation/choice_seat（座席選択画面, 約210KB）
```

**ログイン不要で座席表まで到達できる**（購入の段でログインが要ると推測）。

## 4. 座席のDOM構造（アダプタの中核）

座席は `<map>` 内の `<area>`。1席 = 1 area。

```html
<area id="A-4" type-seat="1" seat-group="null" add-change="0"
      data-coords="186,230,226,270" coords="186,230,226,270"
      shape="rect" class="seat-select">
```

| 属性 | 意味 |
|---|---|
| `id` | **席ID**。`列-番号`（例 `A-4`）。UI の席IDと同じ形式 |
| `class` | `seat-select`=**空席（選択可）** / `sold-out`=**売切** |
| `type-seat` | 席種（1=通常。ペア/エグゼクティブ/プレミア等は別値の可能性。モーダルが `pair-sheet-modal` `executive-seat-modal` `premier-seat-modal` `sofa-seat-modal` `reclining-seat-modal` `trio-seat-modal` `counter-seat-modal` と多数ある） |
| `data-coords` | `x1,y1,x2,y2`。**ピクセル座標**。行=y、席順=x で完全なレイアウトが復元できる |
| `add-change` | 「あとから変更」対象フラグらしい |
| `seat-group` | ペア席等のグループ |

- 空席と売切は class だけで判別できる（`fetchSeatMap` はこれを読む）。
- **座標があるので、近似の台形生成は不要**。area をそのまま持てば実物と一致する。
- 枚数選択のモーダル: `myModalSeat10Button` `myModalSeatMaxButton`
  `myModalSeatDoubleButton` `myModalSeatTripleButton` 等 → 枚数上限UIの手がかり。

### 実測: シアター9（94席、7列・横通路なし）

公開情報の94席と一致。生成レイアウトは近似だったが、実物はこう:

| 列 | 席数 | 席番号 |
|---|---|---|
| A | 9 | 4〜12 |
| B〜E | 各13 | 2〜14 |
| F | 15 | 2〜14, 17〜18（**15・16が欠番＝右側に縦通路**） |
| G | 18 | 1〜18 |

行間は一定（横通路なし）。前方ほど席が少なく左に寄る（A列が4始まり）。

## 5. アダプタ実装への落とし込み（Phase 2）

1. `open(plan)` — スケジュールAPIで対象上映回の `showId`/`filmCode`/`screen` を引き、
   `reservation/index/...` を GET して choice_seat のセッションを確立。待機列に入ったら待つ。
2. `fetchSeatMap()` — choice_seat の `<area>` を読み、`seat-select`→available /
   `sold-out`→taken に変換。座標も一緒に持てば描画も実物どおり。
3. `hold(seatIds)` — 席を選び「次へ」を送信（`seatSubmit` ボタン）。ここから先は
   枚数選択→ログイン→決済。**ログインが必要になる地点で止め、CAPTCHA 等に遭遇したら
   人間に渡す**（RULES.md の設計原則どおり）。
4. レート制限厳守。スケジュールAPI/予約フローを短時間に連打しない。

## 6. ログインの実フロー（2026-08-20 追記・公開ページで確認）

ログインページ `GET /t-joy_yokohama/login`（**CAPTCHA なし**）。CakePHP。

```
POST /t-joy_yokohama/login
  _method     = POST        (hidden)
  _csrfToken  = <login ページの hidden #_csrfToken（128hex）>
  email       = <会員メール>
  password    = <会員パスワード>
  food_order  =             (hidden, 空)
```

- 事前に login ページを GET して **CSRF cookie とトークン**を同じ Cookie ジャーに載せてから POST する（cookie とフォームの `_csrfToken` が対応している必要がある）。
- 成功時はリダイレクトし会員セッションが張られる。失敗時は login ページを再描画（エラー文言）。
- ログイン判定は会員限定要素（ログアウト導線／マイページ）で確認する。
- **認証情報はコード内に持たない**。実行者がローカルの環境変数／gitignore 済みファイルから渡す（クラウド＝Claude 側には一切渡さない）。

## 7. 座席確保（hold）の実フロー（2026-08-21 の choice_seat で確認）

choice_seat 画面のボタン `#seatChoice` → 内部関数 `addChangeSubmit()` が実行する処理：

```
POST /reservation/choiceSeatSave          ← 劇場パス無しの絶対パス
  data       = JSON.stringify({ scheduleId, theaterId, seatArr })
                 seatArr は席IDの配列（例 ["A-2","A-3"]。area の id と同形式）
  _csrfToken = <choice_seat の hidden #csrfToken（128hex）>
  → JSON: { result_code: "done" | "28" | "error" }
     done  = 仮予約成立（＝席を確保）→ 続けて #form を submit
     28    = タイムアウト（/timeout へ）
     error = 再読込
```

`done` の後、choice_seat の `#form` を送信して券種選択へ進む：

```
POST /t-joy_yokohama/reservation/choice_ticket
  _method=POST, _csrfToken, scheduleId, theaterId
```

- **`choiceSeatSave` が成立した時点で席は仮押さえ**。ここが発売直後の速度勝負の核心。
- choice_seat の hidden から取得できる値: `scheduleId`, `theaterId`, `#csrfToken`,
  `#seatArr`(初期空), `#seatLength`(初期0)。
- 仮予約には**時間制限**があり、`/reservation/cancel_temporary_reservation_which_exists`
  で解放する導線がある。確保後は制限時間内に券種・決済を完了する必要がある。
- 我々のアダプタは UI を介さず `seatArr` を直接組んで POST できる（＝最速）。
- **停止点**：券種選択〜決済（choice_ticket 以降）は人間に渡す設計。CAPTCHA や
  想定外画面に遭遇したら即停止（RULES.md の原則）。

### 決済ハンドオフ（要検討・未確定）

仮予約は Node プロセスの Cookie セッションに紐づく。人間のブラウザで続きを払うには
セッション共有が要る。実現案:
- (a) ローカルで**可視ブラウザ（Playwright 等）**を動かし、確保後そのウィンドウで人間が決済 → 同一セッションでハンドオフ問題なし（ローカルPC運用に最適）。
- (b) 純 Node で確保し、Cookie を人間のブラウザへ受け渡す（手間）。
- (c) 会員に**劇場支払い等のカード不要導線**があれば Node で予約完了まで可能（要確認）。

## 8. 未確認・要注意

- 待機列（仮想待合室）に実際に入ったときの挙動・URL は未確認。
- 残席アイコン `icon_label1〜4` と ◎○△× の正確な対応。
- ペア席・エグゼクティブ席等の `type-seat` 値と料金の対応。
- 発売の瞬間（0:00）に choice_seat がどう変わるか（発売前は予約導線が出ない可能性）。
- `choiceSeatSave` がログイン必須かどうか（ログイン後に実行するので実運用上は問題なし）。
- 決済ハンドオフ方式の確定（上記 (a)/(b)/(c)）。
