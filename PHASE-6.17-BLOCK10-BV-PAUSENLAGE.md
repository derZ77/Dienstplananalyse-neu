# Phase 6.17 – Block 10 BV-Pausenlage

## Fachregel

Nur Pausen von 30 bis 120 Minuten werden bewertet. Arbeitszeit vor der Pause
unter 03:30 oder über 04:30 Stunden ergibt `BV-Verstoß`; 03:30 bis 04:30
Stunden einschließlich ergibt `BV eingehalten`.

## Berechnung und Fallback

Die Bewertung verwendet zuerst die Summe vollständig zeitlich vorhandener
Aktivitäten vor der Pause (`Arbeitszeitdaten`). Fehlen diese, verwendet sie die
Zeitdifferenz von Dienstbeginn bis Pausenbeginn. Dieser Fallback ist sichtbar
gekennzeichnet und weist auf die eingeschränkte Datenbasis hin.

## Darstellung

Die Legacy-Pausenanzeige bleibt unverändert oben stehen. Darunter folgt der
getrennte Bereich `BV-Pausenlagenprüfung` mit Dienst, Pause, Dauer, Zeit vor
Pause, Grundlage und Ergebnis. Pausen unter 30 Minuten und Unterbrechungen
über 120 Minuten werden nicht bewertet; JNV-Zusatzunterbrechungen bleiben
getrennt sichtbar.

## Tests

Neue Acceptance-Tests prüfen eingehaltene, zu frühe und zu späte Pausen sowie
den Fallback. Bestehende JES-/JNV- und Legacy-Tests bleiben erhalten.

`npm test`: **2220 bestanden, 0 Fehler, 0 Skips**. Bekannte PDF.js-Warnungen
zu optionalen Canvas-/Schriftkomponenten beeinflussten keine Ergebnisse.

## Offene Punkte

Die Prüfung bewertet zeitliche Lage nur auf Basis vorhandener Daten. Eine
weitergehende fachliche Einordnung kurzer Pausen oder geteilter Dienste bleibt
bei Block 6 beziehungsweise dem 1/6-Modul.
