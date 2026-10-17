# このリポジトリで作業するときのルール

## 成果物の置き場所（ユーザー指示・2026-10-17）

- Claude が作成した成果物（拡張機能・ツール・ドキュメントなど）をユーザーに渡すときは、
  Google Drive の「Claude」フォルダ（My Drive 直下、フォルダ名 `Claude`）に格納する。
  既存の例: `Claude/popup-blocker/`（Brave 用ポップアップブロック拡張機能）
- 例外は「運用に問題が出るもの」だけ。たとえば GitHub Pages で公開する前提のものは
  URL や deploy ワークフローが壊れるので、リポジトリ内の配置は変えない
  （`popup-blocker/` はサイト直下のまま。Drive 側のコピーだけ `Claude/` に置く）。
- Drive に置くときは共有設定をいじらない（非公開のまま）。

## リポジトリの構成メモ

- GitHub Pages のユーザーサイト。`main` への push で `.github/workflows/deploy.yml` が
  リポジトリ全体をそのまま配信する（`.nojekyll` あり）。
- `popup-blocker/` は Brave/Chrome 用拡張機能（Manifest V3）。deploy 時に
  `popup-blocker/popup-blocker.zip` を生成して配布ページ `popup-blocker/index.html` からダウンロードできる。
