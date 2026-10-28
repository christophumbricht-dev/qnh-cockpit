# Registers the Windows task «QNH Studio-Lauf» on the GAMING PC: every 5 minutes scripts/studio-worker.mjs looks for
# a waiting Claude run (cockpit button, or the daily run it queues itself from 08:00) and runs Claude Code headless.
# No window (conhost --headless), also with nobody logged on (S4U). Log: %USERPROFILE%\.qnh-machine\studio-worker.log
#   powershell -ExecutionPolicy Bypass -File scripts\studio-worker-task.ps1
# Needs once: Claude Code installed (npm i -g @anthropic-ai/claude-code) and signed in by Christoph (claude, then /login).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$node = (Get-Command node.exe).Source
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$node`" `"$(Join-Path $PSScriptRoot 'studio-worker.mjs')`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
# a run may take up to 2.5 h; a second start while one runs is skipped (and the script has its own lock)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName 'QNH Studio-Lauf' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"QNH Studio-Lauf registriert (alle 5 Minuten, Tageslauf ab 08:00)"
