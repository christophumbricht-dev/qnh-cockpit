@echo off
rem Run by the Windows task "QNH Rechner-Messung" (machine-task.ps1). Output: %USERPROFILE%\.qnh-machine\task.log
cd /d "%~dp0.."
if not exist "%USERPROFILE%\.qnh-machine" mkdir "%USERPROFILE%\.qnh-machine"
node scripts\machine-heartbeat.mjs %* >> "%USERPROFILE%\.qnh-machine\task.log" 2>&1
