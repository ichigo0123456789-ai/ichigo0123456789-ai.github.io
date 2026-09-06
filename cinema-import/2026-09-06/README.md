# 劇場追加バンドル 2026-09-06（クラウド採取分）

cinema-auto-reserve（Google Drive 上の private リポジトリ）へ取り込むためのデータ。
クラウド側は Drive のファイルを上書きできないため、ここに置いて PC 側で 1 コマンド適用する。

| 劇場 | 都道府県 | runner key | KINEZO path / id | スクリーン | 席数 |
|---|---|---|---|---|---|
| T・ジョイPRINCE品川 | 東京都 | `prince_shinagawa` | `tjoy-prince-shinagawa` / 180 | 10 | 1,686 |
| T・ジョイ蘇我 | 千葉県 | `soga` | `t-joy_soga` / 130 | 12 | 1,850 |

## 適用手順（PC）

```powershell
cd <cinema-auto-reserve のフォルダ>
node <このフォルダ>\apply.js
git add -A
git commit -m "劇場追加: T・ジョイPRINCE品川 / T・ジョイ蘇我（クラウド採取）"
```

- `theaters.entries.txt` … theaters.js に挿入するエントリ（row() 圧縮形式・lat/lng 付き）
- `venues.lines.json` … runner/lib/venues.js の THEATERS に足す 2 行
- `_sc_*.json` … 座席の実座標（tjoy.jp の data-coords）と SCREEN バー実測中心。
  高さ 14px 超・平均色 235 以上の帯は誤検出として棄却し、席範囲中心（extent）にフォールバック
  （PRINCE品川 シアター3/4/7/8、蘇我 シアター12）。
- apply.js は冪等。既に入っている劇場はスキップする。
