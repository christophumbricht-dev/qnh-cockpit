# Run by the Windows task "QNH Social-Import" (daily 07:30 and at logon):
# imports new/changed packages from pakete/ as drafts – never approves or publishes.
# Log: pakete/.import.log (local, last ~400 lines).
[Console]::OutputEncoding = [Text.Encoding]::UTF8 # node writes UTF-8
Set-Location (Join-Path $PSScriptRoot "..")
$log = Join-Path (Get-Location) "pakete\.import.log"
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File -Append -Encoding utf8 $log
& npm.cmd run -s social -- import 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 $log
$lines = Get-Content -Encoding utf8 $log
if ($lines.Count -gt 400) { $lines | Select-Object -Last 400 | Set-Content -Encoding utf8 $log }
