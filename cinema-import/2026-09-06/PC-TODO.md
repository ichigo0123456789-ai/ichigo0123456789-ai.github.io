# PC で追加する関東の映画館（残り）— 反町駅から近い順

クラウドからは tjoy.jp（KINEZO）しか到達できないため、関東の KINEZO 5 館（T・ジョイ横浜・横浜ブルク13・新宿バルト9・T・ジョイPRINCE品川・T・ジョイ蘇我）は全て取り込み済み。
TOHO / 109 は PC（cinema-auto-reserve 直下）で下の順に実行する。距離は反町駅からの直線距離（概算）。
ルール: 東京都・神奈川県を先に、その中で近い順。次に千葉・埼玉・茨城・栃木。

## 事前確認

```powershell
node runner/doctor.js                      # チェーン別ヘルスチェック（✗/△ があれば先に直す）
node -e "console.log(require('./runner/lib/venues.js').resolveTheater('toho_kamiooka'))"   # null なら TOHO_ALIAS に toho_kamiooka: '066' を追加
```

## 追加順

| # | 劇場 | 都道府県 | 距離 | コマンド | 備考 |
|---|---|---|---|---|---|
| 1 | TOHOシネマズ ららぽーと横浜 | 神奈川県 | 5.6 km | `node runner/add-theater.js 036 toho_lalaport_yokohama "TOHOシネマズ ららぽーと横浜" "横浜 / 鴨居（ららぽーと横浜）" "神奈川県" --chain toho` | alias 登録済 |
| 2 | 109シネマズ港北 | 神奈川県 | 8.2 km | `node runner/add-theater.js <alias> kohoku "109シネマズ港北" "横浜 / センター南（港北 TOKYU S.C.）" "神奈川県" --chain 109` | 109 サイトの tsc/別名を確認 |
| 3 | 109シネマズグランベリーパーク | 東京都 | 14.6 km | `node runner/add-theater.js <alias> grandberry "109シネマズグランベリーパーク" "南町田グランベリーパーク" "東京都" --chain 109` | 109 サイトの tsc/別名を確認 |
| 4 | 109シネマズ二子玉川 | 東京都 | 15.1 km | `node runner/add-theater.js <alias> futako "109シネマズ二子玉川" "二子玉川ライズ" "東京都" --chain 109` | 109 サイトの tsc/別名を確認 |
| 5 | TOHOシネマズ 海老名 | 神奈川県 | 21.6 km | `node runner/add-theater.js 007 toho_ebina "TOHOシネマズ 海老名" "海老名 / ビナウォーク" "神奈川県" --chain toho` | alias 登録済 |
| 6 | 109シネマズ湘南 | 神奈川県 | 22.4 km | `node runner/add-theater.js <alias> shonan "109シネマズ湘南" "辻堂 / テラスモール湘南" "神奈川県" --chain 109` | 109 サイトの tsc/別名を確認 |
| 7 | TOHOシネマズ 府中 | 東京都 | 25.4 km | `node runner/add-theater.js 012 toho_fuchu "TOHOシネマズ 府中" "府中 / くるる" "東京都" --chain toho` | TOHO_ALIAS に toho_fuchu: '012' を追加 |
| 8 | TOHOシネマズ 日本橋 | 東京都 | 26.9 km | `node runner/add-theater.js 073 toho_nihonbashi "TOHOシネマズ 日本橋" "日本橋 / コレド室町" "東京都" --chain toho` | alias 登録済 |
| 9 | 109シネマズ木場 | 東京都 | 27.0 km | `node runner/add-theater.js <alias> kiba "109シネマズ木場" "木場 / イトーヨーカドー木場" "東京都" --chain 109` | 109 サイトの tsc/別名を確認 |
| 10 | TOHOシネマズ 南大沢 | 東京都 | 27.2 km | `node runner/add-theater.js 006 toho_minamiosawa "TOHOシネマズ 南大沢" "南大沢 / フレンテ" "東京都" --chain toho` | TOHO_ALIAS に toho_minamiosawa: '006' を追加 |
| 11 | TOHOシネマズ 上野 | 東京都 | 29.3 km | `node runner/add-theater.js 080 toho_ueno "TOHOシネマズ 上野" "上野 / 上野フロンティアタワー" "東京都" --chain toho` | alias 登録済 |
| 12 | TOHOシネマズ 錦糸町（楽天地・オリナス） | 東京都 | 29.7 km | `node runner/add-theater.js 029 toho_kinshicho "TOHOシネマズ 錦糸町（楽天地・オリナス）" "錦糸町" "東京都" --chain toho` | TOHO_ALIAS に toho_kinshicho: '029' を追加 |
| 13 | TOHOシネマズ 立川立飛 | 東京都 | 32.8 km | `node runner/add-theater.js 085 toho_tachikawa "TOHOシネマズ 立川立飛" "立川 / ららぽーと立川立飛" "東京都" --chain toho` | alias 登録済 |
| 14 | TOHOシネマズ 西新井 | 東京都 | 36.6 km | `node runner/add-theater.js 040 toho_nishiarai "TOHOシネマズ 西新井" "西新井 / アリオ西新井" "東京都" --chain toho` | TOHO_ALIAS に toho_nishiarai: '040' を追加 |
| 15 | TOHOシネマズ 小田原 | 神奈川県 | 48.8 km | `node runner/add-theater.js 008 toho_odawara "TOHOシネマズ 小田原" "小田原 / ダイナシティ" "神奈川県" --chain toho` | TOHO_ALIAS に toho_odawara: '008' を追加 |
| 16 | TOHOシネマズ 市川コルトンプラザ | 千葉県 | 39.6 km | `node runner/add-theater.js 003 toho_ichikawa "TOHOシネマズ 市川コルトンプラザ" "市川 / ニッケコルトンプラザ" "千葉県" --chain toho` | TOHO_ALIAS に toho_ichikawa: '003' を追加 |
| 17 | TOHOシネマズ ららぽーと船橋 | 千葉県 | 40.3 km | `node runner/add-theater.js 018 toho_funabashi "TOHOシネマズ ららぽーと船橋" "船橋 / ららぽーとTOKYO-BAY" "千葉県" --chain toho` | TOHO_ALIAS に toho_funabashi: '018' を追加 |
| 18 | TOHOシネマズ ららぽーと富士見 | 埼玉県 | 43.1 km | `node runner/add-theater.js 075 toho_fujimi "TOHOシネマズ ららぽーと富士見" "富士見 / ららぽーと富士見" "埼玉県" --chain toho` | TOHO_ALIAS に toho_fujimi: '075' を追加 |
| 19 | TOHOシネマズ 八千代緑が丘 | 千葉県 | 50.0 km | `node runner/add-theater.js 028 toho_yachiyo "TOHOシネマズ 八千代緑が丘" "八千代緑が丘" "千葉県" --chain toho` | TOHO_ALIAS に toho_yachiyo: '028' を追加 |
| 20 | TOHOシネマズ 流山おおたかの森 | 千葉県 | 51.5 km | `node runner/add-theater.js 035 toho_nagareyama "TOHOシネマズ 流山おおたかの森" "流山おおたかの森 S.C." "千葉県" --chain toho` | TOHO_ALIAS に toho_nagareyama: '035' を追加 |
| 21 | TOHOシネマズ 柏 | 千葉県 | 53.2 km | `node runner/add-theater.js 077 toho_kashiwa "TOHOシネマズ 柏" "柏 / セブンパークアリオ柏" "千葉県" --chain toho` | TOHO_ALIAS に toho_kashiwa: '077' を追加 |
| 22 | TOHOシネマズ 宇都宮 | 栃木県 | 125.5 km | `node runner/add-theater.js 015 toho_utsunomiya "TOHOシネマズ 宇都宮" "宇都宮 / ベルモール" "栃木県" --chain toho` | TOHO_ALIAS に toho_utsunomiya: '015' を追加 |
| 23 | TOHOシネマズ ひたちなか | 茨城県 | 130.8 km | `node runner/add-theater.js 024 toho_hitachinaka "TOHOシネマズ ひたちなか" "ひたちなか / ファッションクルーズ" "茨城県" --chain toho` | TOHO_ALIAS に toho_hitachinaka: '024' を追加 |

## 各劇場を追加した後

1. `node runner/capture-seatcoords.js` で座席実座標を採取し `runner/merge-seatcoords.js` でマージ（README の手順どおり）。
2. theaters.js のエントリに `lat, lng` を足す（near.js の距離表示用）。
3. `node runner/doctor.js` で当該劇場が ✓ になるのを確認してから commit。

## 109 の別名（alias）の調べ方

109 の劇場ページ URL `https://cinema.109cinemas.net/site/det.cgi?tsc=XX` の `XX`（川崎=I1、プレミアム新宿=X1）を `<alias>` に入れる。add-theater.js が tsc を自動取得する。
