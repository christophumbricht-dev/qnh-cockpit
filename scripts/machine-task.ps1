# Registers the Windows task «QNH Rechner-Messung»: every 5 minutes scripts/machine-heartbeat.mjs measures this
# computer for Finanzen → «Rechner». No window (conhost --headless), log in %USERPROFILE%\.qnh-machine\task.log.
#   powershell -ExecutionPolicy Bypass -File scripts\machine-task.ps1 -Machine gaming -Always   (also with nobody logged on)
#   powershell -ExecutionPolicy Bypass -File scripts\machine-task.ps1 -Machine laptop           (while Christoph is logged on)
# -Always needs a user that may run tasks without logging on (on the gaming PC it works; on the laptop Windows refuses it).
param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{2,24}$')][string]$Machine, [switch]$Always)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'machine-heartbeat.cmd'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$script`" --machine $Machine" -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType $(if ($Always) { 'S4U' } else { 'Interactive' }) -RunLevel Limited
Register-ScheduledTask -TaskName 'QNH Rechner-Messung' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'QNH Rechner-Messung'
"QNH Rechner-Messung registriert ($Machine, alle 5 Minuten)"
