@echo off
rem Startet Claude Code im QNH Cockpit mit dem Auftrag Digital Studio.
cd /d C:\QNH\01_Firma\cockpit
where claude >nul 2>nul
if errorlevel 1 (
  echo Claude Code ^(Befehl "claude"^) wurde nicht gefunden.
  echo Kopiere diesen Satz in Claude Code:
  echo Lies CLAUDE.md und docs/auftraege/digital-studio/auftrag.md. Beginne mit D0 und warte auf Christophs Entscheid, dann D1 bis D7 der Reihe nach. Commit nach jedem Punkt, kein Push.
  pause
  exit /b
)
claude "Lies CLAUDE.md und docs/auftraege/digital-studio/auftrag.md. Beginne mit D0: gib Christoph eine kurze Empfehlung, wo die Studio-Videos liegen sollen, und warte auf seinen Entscheid. Danach D1 bis D7 der Reihe nach. Commit nach jedem Punkt, kein Push, Migration nur schreiben, nichts deployen, keine Schluessel im Repo, keine Videos im Git. Am Ende eine kurze deutsche Zusammenfassung mit Testliste und Christophs To-do-Liste."
