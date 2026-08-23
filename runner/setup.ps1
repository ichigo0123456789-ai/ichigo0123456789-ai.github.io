# ============================================================
#  座席オートリザーブ runner セットアップ（Windows / PowerShell）
#  使い方:  リポジトリを展開したフォルダで、PowerShell を開いて
#    cd <このリポジトリ>\runner
#    ./setup.ps1
#  ※ 実行がブロックされる場合は一度だけ:
#    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot   # このスクリプト＝runner/ を作業ディレクトリに

Write-Host "== 座席オートリザーブ runner セットアップ ==" -ForegroundColor Cyan

# 1) Node.js 確認（v18 以上を推奨）
try { $nv = (node -v) } catch {
  Write-Host "Node.js が見つかりません。https://nodejs.org/ から LTS 版を入れて、PC を再起動してから再実行してください。" -ForegroundColor Red
  exit 1
}
Write-Host "Node: $nv"

# 2) 依存パッケージ
Write-Host "-- npm install --" -ForegroundColor DarkGray
npm install

# 3) 決済ブラウザのフォールバック（Brave/Chrome/Edge が無い環境用の内蔵 Chromium）
Write-Host "-- playwright（内蔵 Chromium・フォールバック用）--" -ForegroundColor DarkGray
npx playwright install chromium

# 4) .env を用意（無いときだけ。既存は上書きしない）
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env を作成しました。使う映画館の会員情報だけ記入してください（.env は非公開・git 管理外）。" -ForegroundColor Yellow
} else {
  Write-Host ".env は既にあります（上書きしません）。"
}

Write-Host ""
Write-Host "セットアップ完了。次の手順:" -ForegroundColor Green
Write-Host "  1) runner\.env に、使う映画館チェーンの会員ID/パスワードを記入"
Write-Host "  2) サイトでプランを組み、[コマンドをコピー] を押す"
Write-Host "  3) リポジトリのルートフォルダで貼り付けて実行（まずは末尾に --dry を付けて練習）"
Write-Host '     例) node runner/reserve-hybrid.js --theater shinbungeiza --date 2026-08-25 --title "作品名" --time 17:30 --seats "A-1,A-2" --dry' -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ※ --dry = 席を取らず「確保の直前」で止める練習モード。外すと本番で席を確保します。"
Write-Host "  ※ 決済ブラウザは Brave→Chrome→Edge の順で自動検出。--browser chrome 等で指定も可。"
