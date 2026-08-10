# Phase 6.16 – Block 10 Legacy Parity

## Ergebnis

Block 10 stellt wieder die tabellarische Legacy-Aussage dar: Pausen zwischen
30 und 120 Minuten, gruppiert nach Dienst und zeitlich sortiert. Die Ausgabe
enthält Dienstnummer, Beginn, Ende, Dauer sowie beide Orts- und Kursseiten.
Der Legacy-Leerfall lautet wieder `Keine Pausen im Bereich 30–120 Minuten
gefunden.`

## Änderungen

- Die Block-10-Projektion trennt tabellarische Legacy-Pausen von zusätzlichen
  Canonical-Unterbrechungen.
- Geteilte Dienste und Unterbrechungen außerhalb 30–120 Minuten erscheinen
  nicht als normale Legacy-Pause.
- Vorhandene zusätzliche Canonical-Einträge, insbesondere aus JNV-PDFs,
  bleiben in einer eigenen, klar bezeichneten Sektion sichtbar.
- Der Renderer leitet keine BV-, Mindestpausen- oder Arbeitszeitbewertung mehr
  aus allgemeinen Unterbrechungen ab.
- Parser, CanonicalSchedule-Vertrag, JNV-1/6-Regeln, übrige Blöcke und Export
  wurden nicht geändert.

## Datenquellen und Zuordnung

Die vorhandenen `precedingActivityId`/`followingActivityId`-Referenzen werden
für die Orts- und Kursdarstellung einer tabellarischen Pause verwendet. Fehlen
sie, wird ausschließlich auf die bereits am Canonical-Unterbrechungseintrag
vorhandenen Ortsdaten zurückgegriffen. Es werden keine Pausen oder Zuordnungen
erfunden.

## Nachweise

- JES-Excel-Referenz: tabellarische Pause mit beiden Orten und Kursen;
  keine BV-Zeile.
- JES-PDF-Referenz: exakter Legacy-Leerfall, da keine strukturierte
  Unterbrechung vorliegt.
- JNV-PDF-Referenz: alle 12 strukturierten Unterbrechungen bleiben sichtbar,
  aber getrennt von der tabellarischen Legacy-Aussage.
- Mehrere Unterbrechungen: stabil nach Dienstnummer und Beginn sortiert.

Fokussierte Tests: **10 bestanden, 0 Fehler**.

Vollständige Regression: `npm test` – **2217 bestanden, 0 Fehler, 0 Skips**.
Bekannte PDF.js-Canvas-/Schriftwarnungen beeinflussten keine Testergebnisse.

## Phase 6.17

Die fachliche Bewertung von Pausenlagen bleibt ausdrücklich offen. Eine spätere
BV-Prüfung muss getrennt von Block 10 implementiert und mit eigenen
Acceptance-Tests belegt werden.
