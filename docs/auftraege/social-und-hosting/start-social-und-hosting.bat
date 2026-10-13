@echo off
rem Startet Claude Code im QNH Cockpit mit dem Auftrag Social + Hosting.
cd /d C:\Projects\qnh-cockpit
where claude >nul 2>nul
if errorlevel 1 (
  echo Claude Code ^(Befehl "claude"^) wurde nicht gefunden.
  echo Kopiere diesen Satz in Claude Code:
  echo Lies docs/auftraege/social-und-hosting/auftrag.md und setze H1 bis H4 und S1 bis S6 der Reihe nach um. Commit nach jedem Punkt, kein Push.
  pause
  exit /b
)
claude "Lies CLAUDE.md und docs/auftraege/social-und-hosting/auftrag.md und setze H1 bis H4 (Hosting auf cockpit.setqnh.ch) und S1 bis S6 (Social-Modul mit Freigabe) der Reihe nach um. Commit nach jedem Punkt, kein Push, keine Deploys, kein Supabase-Projekt anlegen, Migrationen nur schreiben, keine Schluessel im Repo. Am Ende eine deutsche Zusammenfassung mit Testliste und Christophs To-do-Liste."
