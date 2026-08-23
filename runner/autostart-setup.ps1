# ============================================================
#  番組表サーバ(serve.js)をログオン時に自動起動する設定
#  - 既定: タスクスケジューラに "CinemaScheduleServer" を登録（ログオン時・非表示・失敗時再試行）
#  - 権限などで登録できない場合: スタートアップフォルダにランチャを置く方式へ自動フォールバック
#  使い方:
#    登録:  powershell -ExecutionPolicy Bypass -File runner\autostart-setup.ps1
#    解除:  powershell -ExecutionPolicy Bypass -File runner\autostart-setup.ps1 -Remove
#  ※ これは「番組表サーバ」の自動起動だけ。実際の予約(reserve-hybrid.js)は従来どおり手動です。
# ============================================================
param([switch]$Remove)

$ErrorActionPreference = "Stop"
$runnerDir = $PSScriptRoot
$vbs = Join-Path $runnerDir "serve-hidden.vbs"
$taskName = "CinemaScheduleServer"
$startupDir = [Environment]::GetFolderPath('Startup')
$startupFile = Join-Path $startupDir "CinemaScheduleServer.vbs"

function Remove-Autostart {
  try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop; Write-Host "タスク $taskName を削除しました" -ForegroundColor Yellow } catch {}
  if (Test-Path $startupFile) { Remove-Item $startupFile -Force; Write-Host "スタートアップのランチャを削除しました" -ForegroundColor Yellow }
  Write-Host "自動起動を解除しました。" -ForegroundColor Green
}

if ($Remove) { Remove-Autostart; return }

if (-not (Test-Path $vbs)) { Write-Host "serve-hidden.vbs が見つかりません: $vbs" -ForegroundColor Red; exit 1 }

$registered = $false
try {
  $action    = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"{0}"' -f $vbs)
  $trigger   = New-ScheduledTaskTrigger -AtLogOn
  $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  $registered = $true
  Write-Host "タスクスケジューラに登録しました: $taskName（次回ログオンから自動起動）" -ForegroundColor Green
} catch {
  Write-Host "タスク登録に失敗したため、スタートアップフォルダ方式にフォールバックします： $($_.Exception.Message)" -ForegroundColor DarkYellow
  $launcher = @"
' 自動生成: 番組表サーバをログオン時に非表示で起動
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$runnerDir"
sh.Run "cmd /c node serve.js", 0, False
"@
  Set-Content -Path $startupFile -Value $launcher -Encoding ASCII
  Write-Host "スタートアップに登録しました: $startupFile（次回ログオンから自動起動）" -ForegroundColor Green
}

# いますぐ一度起動しておく（次回ログオンを待たずに使えるように）
try {
  if ($registered) { Start-ScheduledTask -TaskName $taskName -ErrorAction Stop }
  else { & wscript.exe $vbs }
  Start-Sleep -Milliseconds 1500
  Write-Host "番組表サーバを起動しました（http://127.0.0.1:8790/health で確認できます）" -ForegroundColor Green
} catch {
  Write-Host "今すぐの起動に失敗しました（次回ログオン時には起動します）: $($_.Exception.Message)" -ForegroundColor DarkYellow
}
