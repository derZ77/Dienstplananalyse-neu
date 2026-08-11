# Phase 8.2 – Geteilte Dienste und Pausenlogik vereinheitlichen

## Block 2: Ist/Soll und quellunabhängige Erkennung

Block 2 verwendet weiterhin die vorhandene, migrierte Legacy-Erkennung auf dem CanonicalSchedule. Die Darstellung bezog sich jedoch noch auf Excel-Spalten O/P. Außerdem konnte eine mehrfach repräsentierte identische Dienstnummer die sichtbare Anzahl erhöhen.

Die Projektion fasst deshalb gleiche Dienstnummern für Block 2 zusammen und behält die vollständigste vorhandene Schichtspanne. Die fachliche Aussage lautet nun quellneutral:

`Schichtspanne je geteilter Dienst (Dienstbeginn bis Dienstende)`

Damit zeigen JES Excel, JES PDF und JNV PDF denselben Blockvertrag. Die technische Herkunft ist nicht mehr Teil der fachlichen Hauptdarstellung.

## Block 10: Pausenklassifikation

Die vorhandenen Canonical-Unterbrechungen werden ausschließlich anhand ihrer Dauer eingeordnet:

| Dauer | Block-10-Einordnung |
| --- | --- |
| unter 30 Minuten | kurze Unterbrechung; kein regulärer Blockpause, möglicher 1/6-Kontext |
| 30 bis 120 Minuten einschließlich | reguläre Blockpause mit BV-Pausenlagenprüfung |
| über 120 Minuten | lange Unterbrechung / geteilter Dienst; keine reguläre Blockpause |

Eine reguläre Pause wird nicht mehr allein deshalb ausgeschlossen, weil ihr Dienst als geteilt erkannt wurde. Lange Unterbrechungen bleiben sichtbar, werden jedoch nicht als normale Pause oder BV-Pausenlagenfall dargestellt.

## Pausenlagen-Bewertung und Fallback

Für reguläre Pausen gilt unverändert:

- unter 03:30 h Arbeitszeit vor Pause: BV-Verstoß
- 03:30 h bis 04:30 h einschließlich: BV eingehalten
- über 04:30 h: BV-Verstoß

Die bestehende Berechnungshierarchie bleibt erhalten:

1. strukturierte Arbeitszeitanteile bis zum Pausenbeginn;
2. sichtbar gekennzeichneter Fallback aus Dienstbeginn bis Pausenbeginn.

Pausen werden über `serviceId` und, falls erforderlich, über die vorhandene Dienstnummer dem korrekten Canonical-Dienst zugeordnet. Mehrere Pausen bleiben nach Dienst gruppiert.

## JES/JNV-Vergleich

- JES Excel und JES PDF liefern für die geprüfte Referenz denselben Block-2-Output.
- Die JNV-Referenz enthält geteilte Dienste; ihre IDs werden ohne Doppelzählung dargestellt.
- JNV-lange Unterbrechungen bleiben in Block 10 sichtbar und sind ausdrücklich als nicht reguläre Blockpausen markiert.

## Tests

Neue Acceptance-Tests prüfen:

- Block 2 für wiederholte Dienstnummern, source-neutralen Text, JES Excel/PDF und JNV PDF;
- Pausengrenzen 20, 30, 60, 120 und 121 Minuten;
- Lagegrenzen 03:15, 03:30, 04:30 und 04:45 Stunden;
- strukturierte Berechnung, Fallback-Hinweis und reguläre Pause innerhalb eines geteilten Dienstes;
- Sichtbarkeit langer JNV-Unterbrechungen ohne fälschliche BV-Pausenbewertung.

`npm test`: **2.240 bestanden, 0 Fehler, 0 Skips**.

## Offene Punkte

Die bestehenden 1/6-, Block-4-, Block-6-, Export-, Prüfbericht- und Explorer-Module wurden nicht verändert. Eine fachliche Erweiterung dieser Module ist nicht Bestandteil dieser Phase.
