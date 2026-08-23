#!/usr/bin/env bash
# ============================================================
#  座席オートリザーブ runner セットアップ（macOS / Linux）
#  使い方:  リポジトリを展開したフォルダで
#    cd <このリポジトリ>/runner
#    bash setup.sh
# ============================================================
set -e
cd "$(dirname "$0")"   # runner/ を作業ディレクトリに

echo "== 座席オートリザーブ runner セットアップ =="

# 1) Node.js 確認
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。https://nodejs.org/ から LTS 版を入れてください。" >&2
  exit 1
fi
echo "Node: $(node -v)"

# 2) 依存パッケージ
echo "-- npm install --"
npm install

# 3) 決済ブラウザのフォールバック（内蔵 Chromium）
echo "-- playwright（内蔵 Chromium・フォールバック用）--"
npx playwright install chromium

# 4) .env を用意（無いときだけ）
if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env を作成しました。使う映画館の会員情報だけ記入してください（.env は非公開・git 管理外）。"
else
  echo ".env は既にあります（上書きしません）。"
fi

echo ""
echo "セットアップ完了。次の手順:"
echo "  1) runner/.env に、使う映画館チェーンの会員ID/パスワードを記入"
echo "  2) サイトでプランを組み、[コマンドをコピー] を押す"
echo "  3) リポジトリのルートで貼り付けて実行（まずは末尾に --dry を付けて練習）"
echo '     例) node runner/reserve-hybrid.js --theater shinbungeiza --date 2026-08-25 --title "作品名" --time 17:30 --seats "A-1,A-2" --dry'
echo ""
echo "  ※ --dry = 席を取らず「確保の直前」で止める練習モード。外すと本番。"
echo "  ※ 決済ブラウザは Brave→Chrome→Edge の順で自動検出。--browser chrome 等で指定も可。"
