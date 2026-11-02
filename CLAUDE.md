# このリポジトリで作業するときのルール

## 成果物の置き場所（ユーザー指示・2026-10-17）

- Claude が作成した成果物（拡張機能・ツール・ドキュメントなど）をユーザーに渡すときは、
  Google Drive の「Claude」フォルダ（My Drive 直下、フォルダ名 `Claude`）に格納する。
  既存の例: `Claude/popup-blocker/`（Brave 用ポップアップブロック拡張機能）
- 例外は「運用に問題が出るもの」だけ。たとえば GitHub Pages で公開する前提のものは
  URL や deploy ワークフローが壊れるので、リポジトリ内の配置は変えない
  （`popup-blocker/` はサイト直下のまま。Drive 側のコピーだけ `Claude/` に置く）。
- Drive に置くときは共有設定をいじらない（非公開のまま）。
- **Drive 上のファイルを更新する手順（壊さないために厳守）**：
  - ユーザーは Google Drive for Desktop で `Claude/popup-blocker` を同期し、Brave から直接読み込んでいる。
    同じフォルダに同名ファイルが一瞬でも2つ並ぶと、PC 側で `xxx (1).js` が作られて拡張が壊れる。
  1. 古いファイルをゴミ箱へ移した**直後**に、同名の新ファイルをアップロードする（1ファイルずつ、間を空けずに）
  2. 新旧を同時に並べない（「新しいのを先に上げる」は禁止）。フォルダ自体は絶対に消さない・作り直さない。
     フォルダIDは固定：`Claude/popup-blocker` = `1IyVBnlV8PA2ehgmf1Gz1wP57NK5lGnoa`、`icons` = `1tPbm8GAtfMqQXP2ahBOhE6wskpnoH2Fi`
  3. 最後にフォルダを一覧して、全ファイルが1個ずつ・サイズがローカルと一致することを確認する
  4. バックグラウンドの作業者に任せず、フォアグラウンドで直接やる

## リポジトリの構成メモ

- GitHub Pages のユーザーサイト。`main` への push で `.github/workflows/deploy.yml` が
  リポジトリ全体をそのまま配信する（`.nojekyll` あり）。
- `popup-blocker/` は Brave/Chrome 用拡張機能（Manifest V3）。deploy 時に
  `popup-blocker/popup-blocker.zip` を生成して配布ページ `popup-blocker/index.html` からダウンロードできる。
