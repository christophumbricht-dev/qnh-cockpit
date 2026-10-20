# Finanzen – Kosten, Abos und Rechnungen

Im Cockpit unter **Finanzen** (`#finanzen`). Bezahlt wird weiterhin im **E-Banking** – das Cockpit hat keinen Zugriff auf deine Bank. Es zeigt dir, was wann fällig ist, und du hakst ab.

## Einrichten (einmal, 2 Minuten)
1. Supabase → Projekt «QNH Core» → **SQL Editor → New query**.
2. Inhalt von `supabase/migrations/20261021100000_finance.sql` einfügen → **Run**.
3. Cockpit neu laden → in der Seitenleiste erscheint **Finanzen**.

Das legt an: Tabellen `fin_costs` (Abos und feste Kosten) und `fin_bills` (Rechnungen), einen **privaten** Speicher `finance` für Rechnungs-PDFs und -Fotos (nur für Admins, Links gelten 5 Minuten) – und für die Roadmap «wiederkehrend» und «Morgen» (siehe unten).

## Rechnungen
- **Rechnung erfassen** oder PDF/Foto auf die Fläche ziehen. Ist es eine **QR-Rechnung**, liest das Cockpit Empfänger, IBAN, Betrag, Referenz, Mitteilung und Rechnungsnummer selbst – direkt auf deinem Gerät, die Datei verlässt es erst beim Speichern (privat).
- Die **Fälligkeit** kommt aus den Zahlungsbedingungen der QR-Rechnung (falls vorhanden), sonst 30 Tage – bitte kurz prüfen.
- **Zahlungsdaten** zeigt IBAN, Referenz und Betrag zum Kopieren; die meisten Banking-Apps scannen die QR-Rechnung aber direkt aus dem PDF.
- **Bezahlt ✓** – auch direkt auf «Heute».
- Auf «Heute»: überfällig → **Jetzt**, in 0–2 Tagen fällig → **Heute**, in 3–7 Tagen → **Diese Woche**.

## Kosten & Abos
- Pro Abo: Betrag, Währung, Intervall (monatlich, vierteljährlich, jährlich, einmalig), **nächste Verlängerung** (ein Datum reicht, das Cockpit rechnet weiter), App/Marke, Zahlungsart, Link zum Verwalten/Kündigen.
- **Erinnerung (Tage vorher):** z. B. 30 beim Apple-Developer-Konto → 30 Tage vor der Verlängerung steht es auf «Heute», damit du rechtzeitig kündigen kannst. **Behalten** blendet die Erinnerung für diese Verlängerung aus.
- **Vorlagen** (Apple, Supabase, Infomaniak, GitHub …) füllen Name, Anbieter, Kategorie und Link aus – den Betrag trägst du selbst ein.
- Übersicht: Fixkosten pro Monat und Jahr (je Währung, keine erfundenen Wechselkurse), nächste 30 Tage, Fixkosten pro App/Marke.

## Export für den Treuhänder
Unten auf der Seite: **Rechnungen als CSV** und **Kosten als CSV** (Excel-tauglich, Semikolon).

## Roadmap: wiederkehrend und «Morgen»
- Im Roadmap-Eintrag **↻ wiederholen** wählen (wöchentlich, monatlich, vierteljährlich, jährlich), z. B. «MWST-Abrechnung» vierteljährlich. **Erledigt** schiebt die Fälligkeit aufs nächste Mal, statt den Eintrag abzuschliessen.
- Auf «Heute» verschiebt **Morgen** einen fälligen Eintrag auf morgen.

## Später (noch nicht eingebaut)
Belege per Foto (Spesen), Einnahmen aus dem App Store, Anbindung an die Buchhaltung (z. B. Bexio), pain.001-Datei für den Sammelauftrag im E-Banking.
