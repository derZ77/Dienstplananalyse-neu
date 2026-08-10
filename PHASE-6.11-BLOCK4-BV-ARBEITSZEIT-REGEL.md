# Phase 6.11 – Block 4 BV-Arbeitszeitregel Bewertung

## 1. BV-Grundlage

Für Montag–Freitag-Dienstpläne bewertet Block 4 zusätzlich zur bisherigen
Feststellung die angegebene BV-Zählregel:

1. alle Dienste mit bezahlter Zeit über 08:30 h erfassen;
2. vorhandene Reserve-Dienste erkennen;
3. Reserve-Dienste aus der BV-Zählung entfernen;
4. bei höchstens einem verbleibenden Dienst `BV eingehalten`, bei mehr als
   einem `BV-Verstoß / Prüfung erforderlich` ausgeben.

Die Ausnahme wird ausschließlich als Zähl-Ausnahme dargestellt. Es wird keine
neue Berechnung der bezahlten Zeit vorgenommen und keine zusätzliche
Reserve-Klassifikation erzeugt.

## 2. Legacy-Verhalten

Die ursprüngliche erste Zeile bleibt unverändert:

`Dienste >08:30h: <sortierte ID-Liste>`

Grenzwert (> 510 Minuten), Dienstzuordnung, numerische Sortierung und der
Legacy-Leerfall wurden nicht verändert. Die BV-Information erscheint nur nach
einer Leerzeile als zweite Ebene.

## 3. Neue Bewertungsebene

Für eindeutig erkannte Mo–Fr-Pläne zeigt Block 4:

- Anzahl aller gefundenen Dienste über 08:30 h;
- Anzahl der davon als Reserve bekannten Dienste;
- die für die BV relevante Restanzahl;
- eine Detailliste `Dienst | Bezahlte Zeit | Typ`;
- Begründung der Reserve-Ausnahme;
- Ergebnis `BV eingehalten` oder `BV-Verstoß / Prüfung erforderlich`.

Für nicht eindeutig als Montag–Freitag erkannten Zeitraum zeigt der Block
`Nicht anwendbar`. Er leitet keinen Wochentag aus Dateiname, Quelle oder
anderen nicht vorhandenen Daten ab.

## 4. Datenquelle und Datenfluss

`CanonicalSchedule.services[].paidTime`

`→ legacy.longPaidServices (> 510 Minuten)`

`→ legacy.reserveServices (bestehende Reserve-ID-Liste)`

`→ Block-4-BV-Projektion → #long-result`

Die vorhandene Prüfung `BV005` bleibt unverändert. Sie bildet eine eigenständige
Maximalzeitprüfung ohne Ausnahmebehandlung ab und wird durch diese reine
Block-4-Zählanzeige weder verändert noch überschrieben.

## 5. Geänderte Dateien

- `js/v2/blocks/block-orchestrator.js`
- `tests/phase6-10-block4-legacy-parity.test.js` (Legacy-Zeile getrennt von
  der neuen Ebene prüfen)
- `tests/phase6-11-block4-bv-working-time.test.js`

## 6. Tests

Neu abgedeckt:

- mehrere normale Überschreitungen plus ein Reserve-Dienst: zwei relevante
  Dienste und `BV-Verstoß / Prüfung erforderlich`;
- ein normaler plus ein Reserve-Dienst: ein relevanter Dienst und
  `BV eingehalten`;
- JES-Excel und JES-PDF: identische Legacy-Zeile und identische, wegen
  fehlendem eindeutigem Zeitraum nicht anwendbare Bewertung;
- JNV-PDF: vorhandene bezahlte Zeiten, Reserve-Zählung und getrennte
  Montag–Freitag-Bewertung.

Gezielter Lauf: 10 bestanden, 0 Fehler. Vollständige Regression: `npm test`
mit 2.204 bestandenen Tests, 0 Fehlern und 0 Skips. Die bekannten
PDFJS-Canvas-/Standardfont-Hinweise der Node-Testumgebung traten auf, ohne ein
Testergebnis zu beeinflussen.

## 7. Offene Punkte

Die bestehende Reserve-Erkennung ist die historische feste Dienstnummernliste.
Falls eine andere Reserve-Kennzeichnung fachlich erforderlich wird, fehlt dafür
derzeit eine zusätzliche, verlässliche Canonical-Datenquelle; sie wurde in
dieser Phase nicht erfunden.

Die Darstellung prüft gemäß Aufgabenstellung die BV-Zählung. Eine eigenständige
Grenzprüfung, ob ein Reserve-Dienst genau 09:00 h und nicht länger geplant ist,
wurde nicht ergänzt, weil die vorgegebenen Prüfschritte Reserve-Dienste vollständig
aus der Zählung entfernen und keine weitere Grenze dafür definieren.
