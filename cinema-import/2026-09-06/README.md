# 劇場追加バンドル 2026-09-06/07（クラウド採取分・関東 17 館）

cinema-auto-reserve（Google Drive 上の private リポジトリ）へ取り込むためのデータ。
クラウド側は Drive のファイルを上書きできないため、ここに置いて PC 側で 1 コマンド適用する。

## 適用手順（PC）

```powershell
cd <cinema-auto-reserve のフォルダ>
node <このフォルダ>\apply.js
node runner/doctor.js          # 追加した劇場が ✓ になることを確認
git add -A
git commit -m "劇場追加: 関東 17 館（クラウド採取）"
```

apply.js は冪等。既に入っている劇場・別名・修正はスキップする。

## 追加される劇場（すべて実サイトの座席表から採取・全席に座標あり）

| 劇場 | 都道府県 | runner key | サイト指定 | スクリーン | 席数 |
|---|---|---|---|---|---|
| T・ジョイPRINCE品川 | 東京都 | `prince_shinagawa` | KINEZO `tjoy-prince-shinagawa` / 180 | 10 | 1,686 |
| T・ジョイ蘇我 | 千葉県 | `soga` | KINEZO `t-joy_soga` / 130 | 12 | 1,850 |
| TOHOシネマズ ららぽーと横浜 | 神奈川県 | `toho_lalaport_yokohama` | TOHO 036 | 13 | 2,465 |
| 109シネマズ港北 | 神奈川県 | `kohoku` | 109 tsc=13 | 7 | 1,068 |
| 109シネマズグランベリーパーク | 東京都 | `grandberry` | 109 tsc=G1 | 10 | 1,493 |
| 109シネマズ二子玉川 | 東京都 | `futako` | 109 tsc=T1 | 11 | 1,665 |
| TOHOシネマズ 海老名 | 神奈川県 | `toho_ebina` | TOHO 007 | 10 | 2,220 |
| 109シネマズ湘南 | 神奈川県 | `shonan` | 109 tsc=R1 | 10 | 2,045 |
| TOHOシネマズ 府中 | 東京都 | `toho_fuchu` | TOHO 012 | 9 | 2,102 |
| TOHOシネマズ 日本橋 | 東京都 | `toho_nihonbashi` | TOHO 073 | 9 | 1,750 |
| 109シネマズ木場 | 東京都 | `kiba` | 109 tsc=20 | 8 | 1,377 |
| TOHOシネマズ 南大沢 | 東京都 | `toho_minamiosawa` | TOHO 006 | 9 | 1,948 |
| TOHOシネマズ 上野 | 東京都 | `toho_ueno` | TOHO 080 | 8 | 1,391 |
| TOHOシネマズ 錦糸町（楽天地・オリナス） | 東京都 | `toho_kinshicho` | TOHO 029（楽天地は購入 site 082） | 12 | 2,332 |
| TOHOシネマズ 立川立飛 | 東京都 | `toho_tachikawa` | TOHO 085 | 9 | 1,605 |
| TOHOシネマズ 西新井 | 東京都 | `toho_nishiarai` | TOHO 040 | 10 | 1,795 |
| TOHOシネマズ 小田原 | 神奈川県 | `toho_odawara` | TOHO 008 | 9 | 1,800 |

これで神奈川・東京の TOHO / 109 / KINEZO は全館そろう（既存: T・ジョイ横浜・ブルク13・バルト9・109川崎・プレミアム新宿・TOHO新宿/日比谷/渋谷/六本木/池袋/川崎/上大岡）。

## apply.js がやること

0. `patches/toho-site-cd.js` … runner/lib/toho.js の修正。複数建屋の劇場は購入入口の site_cd を
   「その回の theaterCd の先頭 3 桁」にしないと `指定された上映情報が存在しません (ERR-1180)` になる
   （錦糸町 楽天地 = theaterCd 0821 → site 082。番組表は 029 でまとめて取れる）。
   Drive 側の toho.js が更新されていてパターンが一致しない場合はメッセージを出して続行する。
   その場合は openShow 内の `this.code`（URL と site_cd）を `siteOf(p, this.code)` に手で置き換える。
1. `theaters.entries.txt` … theaters.js に挿入するエントリ（row() 圧縮形式・lat/lng 付き）。id ごとに未登録分だけ挿入。
2. `venues.lines.json` … THEATERS（KINEZO 2 館）・THEATERS_109（5 館）の行。`toho_alias.json` … TOHO_ALIAS に足す別名
   （上大岡と関東 TOHO 13 館。千葉・埼玉ほかの分も先に登録済みなので PC-TODO の追加はコマンドだけで済む）。
3. `_sc_*.json` … 座席座標。runner/merge-seatcoords.js で seatcoords.js にマージし、席 ID の突合を検証。
   - KINEZO 2 館: tjoy.jp の data-coords 実座標と SCREEN バー実測中心（高さ 14px 超・平均色 235 以上の帯は
     誤検出として棄却し席範囲中心にフォールバック: PRINCE品川 3/4/7/8、蘇我 12）。
   - TOHO / 109 の 15 館: runner/capture-seatcoords.js と同じ方式（席番号グリッド、centerSource=extent）。

## 採取時の注意点

- ららぽーと横浜: サイト側にスクリーン 13 が無く、`s14` の名前が「スクリーン１３」になっている（サイトの表記どおり）。
- 二子玉川: グランド EXE のスクリーンコードが `16908` なので id は `s16908`（サイトのコードどおり）。
- 錦糸町: オリナス 8 + 楽天地 4 = 12 スクリーン。楽天地は上記パッチが無いと座席表が取れない。
