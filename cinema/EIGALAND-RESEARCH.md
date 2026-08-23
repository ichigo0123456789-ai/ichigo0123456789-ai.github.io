# eigaland（新文芸坐ほか）予約システム調査メモ 2026-08-23

新文芸坐の予約は **eigaland**（app.eigaland.com、Next.js SPA）。新文芸坐の cinemaId(brand) = `621c83f80a861337f2dd3715`。
予約導線：`https://app.eigaland.com/booking?scheduleId=<24hex>`（各上映回に scheduleId）。**ゲスト購入可**（座席選択→「ゲストで購入」）。

## 読み取りAPI（認証不要・JSON・GET）
- `GET /endUser/film/scheduleSeatPlan/{scheduleId}`
  - `data.houseInfo.seatingPlan.seats` … 2次元配列。各セル `{sid,text,rowString,seatStatus}`。
    seatStatus: `general`(空席) / `sold`(売切) / `close`(非売) / `delete`(通路) / `vip` / `special`(女性専用) / `posCounter`(窓口専売)。
  - `data.scheduleInfo` … `startTime/endTime`(epoch ms)、`freeSeat`(自由席か)、`ticketRuleName`、
    `webStartSale`/`webEndSale`（一般ネット発売の開始/終了 epoch ms）、`webPreSaleTime`（会員先行 epoch ms）、`webPreSaleRule`。
    ※発売時刻はこの API から回ごとに取れる（会員先行 webPreSaleTime も）。
- `GET /endUser/film/showingDayList`（上映日一覧）
- `GET /endUser/film/showingFilmListByCinema`（劇場の作品一覧）
- `GET /endUser/film/listShowingByCinemaAndFilmAndDate`（作品×日の上映回＝scheduleId 群）
- `GET /endUser/ticketView/list`

Cookie: `app_version=1.3.0`（付けておく）。CDN=Cloudflare、応答は zstd。

## 予約（確保）API＝webShoppingCart 系（要 payload 確定）
呼び出しラッパは `i.Z({url, method, data})`。判明した順序：
1. `POST /api/webShoppingCart/createWebShoppingCartTransaction` … 取引開始（transactionId 発行）
2. `GET  /api/webShoppingCart/holdSeat` … **席の確保**（data に seats 等。method=GET だが data 同梱）
   - 面席用に `holdAreaSeat` / 解放 `releaseSeat` / `releaseAreaSeat` あり
3. `POST /api/webShoppingCart/getTicketTypes` … 券種一覧
4. `POST /api/webShoppingCart/assignPaymentType` → `getPaymentDetail` → `confirmPayment` → `confirmPaymentDone`
5. 取消：`removeTransaction` / `removeOrderItem` / `removeOrderItemAndReleaseAreaSeat`
6. クーポン：`submitOrderCoupon` / `checkTicketCouponCodeExist` 等

payload の共通フィールド候補（bundle 出現頻度）：`scheduleId`(多)、`cinemaId`、`transactionId`、`seats`、`deviceType`、`shopId`。
→ **createWebShoppingCartTransaction と holdSeat の正確な引数は、発売中の回で実リクエストを1回キャプチャして確定する**（React内でminifyされ静的には取り切れない）。

## 実装方針（cinecitta/sunshine と同型）
- `lib/eigaland.js`：init（cinemaId固定）／fetchSchedule（showingDayList→listShowing…で日付の scheduleId 群＋seatPlanで席/発売時刻）／
  openShow（createTransaction）／fetchSeatMap（seatingPlan の general/sold から）／secure（holdSeat）／
  handoff（決済ブラウザで transaction を復元 or booking?scheduleId= を開いて席選択済み状態へ）。
- ゲスト購入で券種選択の手前まで（券種＝料金は自動選択しない方針を踏襲）。
- 会員先行：scheduleInfo.webPreSaleTime を onSale に採用可（新文芸坐の会員種別は要確認）。

## 残タスク
1. 発売中の回で createWebShoppingCartTransaction / holdSeat の request body を実キャプチャ（payload 確定）。
2. handoff 方式の決定（webShoppingCart の transaction を決済ブラウザへ引き継ぐ／または booking ページで座席選択を自動化）。
3. lib/eigaland.js 実装 → runner/add-theater/theaters.js 連携（chain: 'eigaland'）。
