# Finanzen – Kosten, Abos und Rechnungen

Im Cockpit unter **Finanzen** (`#finanzen`). Bezahlt wird weiterhin im **E-Banking** – das Cockpit hat keinen Zugriff auf deine Bank. Es zeigt dir, was wann fällig ist, und du hakst ab.

## Einrichten (einmal, 2 Minuten)
1. Supabase → Projekt «QNH Core» → **SQL Editor → New query**.
2. Inhalt von `supabase/migrations/20261021100000_finance.sql` einfügen → **Run**.
3. Cockpit neu laden → in der Seitenleiste erscheint **Finanzen**.

Das legt an: Tabellen `fin_costs` (Abos und feste Kosten) und `fin_bills` (Rechnungen), einen **privaten** Speicher `finance` für Rechnungs-PDFs und -Fotos (nur für Admins, Links gelten 5 Minuten) – und für die Roadmap «wiederkehrend» und «Morgen» (siehe unten). Das Skript darf mehrmals laufen.

## Rechnungen
- **Rechnung erfassen** oder PDF/Foto auf die Fläche ziehen (PDF, JPG, PNG, HEIC oder WebP, bis 10 MB). Ist es eine **QR-Rechnung**, liest das Cockpit Empfänger, IBAN, Betrag, Referenz, Mitteilung und Rechnungsnummer selbst – direkt auf deinem Gerät, auch aus **eingescannten PDFs** (Fax-/Scanner-Komprimierung). Die Datei verlässt dein Gerät erst beim Speichern (privat).
- Die **Fälligkeit** kommt aus den Zahlungsbedingungen der QR-Rechnung (Rechnungsdatum + Zahlungsfrist). Fehlt etwas, steht dabei, was angenommen wurde («Rechnungsdatum + 30 Tage», «heute + 30 Tage») – bitte kurz prüfen. Liegt die Fälligkeit schon in der Vergangenheit, steht ein Hinweis da.
- **Hinweise ⚠** beim Lesen: Dinge, die die Bank ablehnen würde oder die du prüfen solltest – z. B. IBAN nicht aus der Schweiz/Liechtenstein, QR-IBAN ohne QR-Referenz (oder umgekehrt), falsche Prüfziffer einer RF-Referenz, Währung nicht CHF/EUR, Betrag 0.00 («Nicht zur Zahlung verwenden» – nur eine Mitteilung). Die Rechnung lässt sich trotzdem speichern.
- Ist der Empfänger **genau** der Anbieter oder Name eines Abos (z. B. «Infomaniak»), wird die Rechnung mit dem Abo verknüpft. Eine App/Marke, die du schon gewählt hast, bleibt.
- Datei **ersetzen** (andere Datei wählen) oder **entfernen** («Datei entfernen») – die alte Datei wird dabei gelöscht. Gespeichert wird immer zuerst die Rechnung, dann die Datei: klappt das Hochladen nicht, ist die Rechnung trotzdem da und «Speichern» versucht es nochmals.
- **Zahlungsdaten** zeigt IBAN, Referenz und Betrag zum Kopieren; die meisten Banking-Apps scannen die QR-Rechnung aber direkt aus dem PDF. **Rechnung ansehen ↗** öffnet die gespeicherte Datei (auch auf dem iPhone).
- **Bezahlt ✓** – auch direkt auf «Heute». Das Zahlungsdatum gilt nach Schweizer Zeit.
- Auf «Heute»: überfällig → **Jetzt**, in 0–2 Tagen fällig → **Heute**, in 3–7 Tagen → **Diese Woche**. Rechnungen **ohne Fälligkeit** gelten als fällig 30 Tage nach dem Erfassen («Fälligkeit geschätzt»), damit sie nicht ewig auf «Diese Woche» stehen.

## Kosten & Abos
- Pro Abo: Betrag, Währung, Intervall (monatlich, vierteljährlich, jährlich, einmalig), **nächste Verlängerung** (ein Datum reicht, das Cockpit rechnet weiter), App/Marke, Zahlungsart, Link zum Verwalten/Kündigen.
- **Erinnerung (Tage vorher):** z. B. 30 beim Apple-Developer-Konto → ab 30 Tagen vor der Verlängerung steht es auf «Heute» (in der Woche davor schon als Vorschau unter «Diese Woche»), damit du rechtzeitig kündigen kannst. **Behalten** blendet die Erinnerung für diese Verlängerung aus – gespeichert beim Abo, also auf allen Geräten; vor der nächsten Verlängerung erinnert das Cockpit wieder. Änderst du Datum oder Intervall, gilt «Behalten» nicht mehr.
- **Vorlagen** (Apple, Supabase, Infomaniak, GitHub …) füllen Name, Anbieter, Kategorie und Link aus – den Betrag trägst du selbst ein.
- Übersicht: Fixkosten pro Monat und Jahr (je Währung, keine erfundenen Wechselkurse), nächste 30 Tage (ist die Rechnung einer Verlängerung schon erfasst, zählt sie nur einmal – als Rechnung), Fixkosten pro App/Marke.
- Verlängerungen bleiben auf ihrem Tag: ein Abo vom 31.1. verlängert sich am 28.2., dann wieder am 31.3.

## Privat bezahlt (Vorgründung und später)
Einmal im SQL-Editor `supabase/migrations/20261021120000_finance_private.sql` ausführen. Danach:
- Beim Erfassen **«Bezahlt von: Christoph privat»** wählen – die Rechnung gilt als bezahlt, und die GmbH schuldet dir den Betrag. Dazu MWST und «Bezahlt mit» (Kreditkarte, Twint …).
- Oben steht **«Offen an Christoph»** (pro Währung, nie umgerechnet), darunter die Liste. Überweist dir die GmbH das Geld: **«Zurückbezahlt ✓»** (einzeln oder alle auf einmal).
- Viele Belege auf einmal: am Laptop eine `ausgaben.json` neben die PDFs legen und
  `npm.cmd run finanzen -- import "C:\QNH\04_Finanzen\Buchhaltung\<Ordner>\ausgaben.json"` ausführen (zuerst mit `--dry` als Probelauf).
  Lädt jeden Beleg mit seinem PDF hoch, legt wiederkehrende Kosten als Abo an und überspringt, was schon im Cockpit ist – darf also mehrmals laufen. Einträge mit `"reimburse": false` (privat, nicht abrechnen) werden nicht übernommen. Format: siehe Kopf von `scripts/finanzen-lib.mjs`.
- `npm.cmd run finanzen -- offen` zeigt, was die GmbH dir noch schuldet.

Die Originale bleiben in der Ablage (kDrive / `QNH-Ablage`) – das Cockpit hat nur eine Kopie. Echte Beträge, Belegnummern und PDFs kommen nie ins (öffentliche) Git.

## Export für den Treuhänder
Unten auf der Seite: **Zeitraum** wählen (dieses Jahr, letztes Jahr, alles), dann **Rechnungen als CSV** – das sind **alle** Rechnungen des Zeitraums (auch ältere, die auf der Seite nicht mehr stehen): bezahlte nach dem Zahlungstag, offene und stornierte nach der Fälligkeit. **Kosten als CSV** listet die Abos, wie sie jetzt sind. Excel-tauglich (Semikolon, Umlaute ok, nichts wird als Formel ausgeführt).

## Roadmap: wiederkehrend und «Morgen»
- Im Roadmap-Eintrag **↻ wiederholen** wählen (wöchentlich, monatlich, vierteljährlich, jährlich), z. B. «MWST-Abrechnung» vierteljährlich. **Erledigt** schiebt die Fälligkeit aufs nächste Mal, statt den Eintrag abzuschliessen – auf «Heute», im Fokus-Modus (danach kommt der nächste Task) und im Bearbeiten-Formular.
- Der Tag bleibt: Das Datum, das du im Eintrag wählst, bestimmt den Tag im Monat. **Für «Monatsende» den 31. wählen** (z. B. 31.3.) – dann 30.6., 30.9., 31.12. (die Karte zeigt «Monatsende»).
- **Endgültig abschliessen:** im Eintrag «einmalig» wählen und Status «Erledigt» – in einem Mal speichern.
- Auf «Heute» verschiebt **Morgen** einen fälligen Eintrag auf morgen.
- Claude macht es gleich: `npm run roadmap -- set <id> --status done` schiebt einen wiederkehrenden Eintrag weiter; nur mit `--final` wird er abgeschlossen.

## API-Verbrauch (Kommentar-Vorschläge)
Unter **Kosten & Abos** zeigt der Block **«API-Verbrauch»**, was die Kommentar-Vorschläge von Social → «Bei anderen» bei Anthropic kosten: diesen Monat (Schweizer Zeit) im Verhältnis zum Monatsbudget, die letzten Monate und das laufende Jahr. Gerechnet wird pro Vorschlag aus den Tokens mit den Preisen von Anthropic (USD). Das ist der **Verbrauch** – bezahlt wird über Guthaben, das du bei Anthropic per Kreditkarte auflädst. Diese Aufladungen erfasst du wie jede Quittung als Beleg (Kategorie «Software»). Ein/Aus und Budget stellst du in «Bei anderen» ein (`docs/social-outreach.md`).

## Später (noch nicht eingebaut)
Belege per Foto (Spesen), Einnahmen aus dem App Store, Anbindung an die Buchhaltung (z. B. Bexio), pain.001-Datei für den Sammelauftrag im E-Banking.
