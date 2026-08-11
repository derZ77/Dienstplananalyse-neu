# Phase 8.3 – Review Dashboard, Prüfbericht und Check Explorer

## 1. Executive Summary

Die drei Bereiche konsumieren weiterhin denselben vorhandenen `CheckReport`.
Es wurde keine Prüfregel, kein Parser und kein CanonicalSchedule-Vertrag verändert.

Vier eindeutig belegte Darstellungs- bzw. Zuordnungsfehler wurden bereinigt:

1. Das Review Dashboard leitete den Warnstatus nur aus der Severity ab. Damit konnten
   `PASS`, `SKIP` oder `NOT_APPLICABLE` mit einer technischen Severity als auffälliger
   Dienst erscheinen. Nun zählt ausschließlich ein Resultat mit `status: FAIL` als
   dienstbezogene Auffälligkeit.
2. Explorer und Dashboard konnten rohe `affectedServices`-IDs als Dienstnummern
   darstellen. Mit vorhandenem CanonicalSchedule wird nun ausschließlich
   `CanonicalSchedule.services[id].serviceNumber` angezeigt; nicht auflösbare interne
   IDs bleiben in der produktiven Oberfläche leer.
3. Der Prüfbericht fasste `SKIP` und `NOT_APPLICABLE` in einer einzigen Kennzahl
   zusammen. Beide Status werden jetzt getrennt ausgewiesen.
4. Die Berichtsmetadaten lasen nur das frühere Feld `scheduleDayType`. Das vorhandene,
   vom Matcher gelieferte Feld `matching.validity.dayType` wird nun direkt durchgereicht;
   das frühere Feld bleibt kompatibel unterstützt.

## 2. Gemeinsame Ergebnisquelle und Konsistenz

```
CheckReport (unverändert)
   ├─ Review Dashboard
   ├─ Prüfbericht
   └─ Check Explorer

CanonicalSchedule (nur Anzeige-Kontext)
   └─ service.id → service.serviceNumber
```

Die neue Anzeigezuordnung läuft über den bereits vorhandenen Session-Kontext. Sie
erzeugt weder einen zweiten Report noch eine neue Fachbewertung. Status und Severity
des CheckResults bleiben unverändert.

Für die Dienstübersicht gilt jetzt:

`kritische Dienste + Dienste mit Warnungen + unauffällige Dienste = Gesamtdienste`.

Gleiche Dienstnummern werden dabei weiterhin nur einmal geführt.

## 3. Warnklassifikation im Review Dashboard

| CheckResult | Dashboard-Wirkung |
| --- | --- |
| `FAIL` mit `WARNING`, `VIOLATION` oder `ERROR` | auffällig; Severity bestimmt Warnung bzw. kritisch |
| `PASS` | unauffällig |
| `NOT_APPLICABLE` | unauffällig |
| `SKIP` | unauffällig |
| reine Information | unauffällig |

Diese Änderung korrigiert nur die Präsentation. Ob ein Check ein `FAIL` liefert,
bleibt vollständig Sache der vorhandenen Regelmodule.

## 4. Prüfbericht: Statusmodell

Der Prüfbericht stellt die unveränderte CheckResult-Terminologie verständlich dar:

| Status | Bedeutung in der Ansicht | Voraussetzung / Nutzung |
| --- | --- | --- |
| `PASS` | Bestanden | Regel war anwendbar und wurde ohne Auffälligkeit bewertet. |
| `FAIL` | Prüfauffälligkeit | Regel war anwendbar und hat eine fachliche Auffälligkeit geliefert. Die Severity erklärt Warnung, Regel nicht erfüllt oder technischen Fehler. |
| `NOT_APPLICABLE` | Nicht anwendbar | Die Datenvoraussetzung der Regel liegt nicht vor; es wurde keine Bewertung versucht. |
| `SKIP` | Übersprungen | Eine Regel konnte wegen einer explizit fehlenden Voraussetzung nicht ausgewertet werden. |
| Runner-Fehler | Technische Fehler | Ein Modulfehler wird separat in der Kopfkennzahl ausgewiesen. |

Der JNV-Einzel-PDF-Lauf zeigte die aktuell registrierten Basischecks:

| Check-ID | Datenvoraussetzung / beobachteter Status |
| --- | --- |
| BV001 | Ortsstamm und zuordenbare Vor-/Nachbereitung; ohne Ortsstamm `NOT_APPLICABLE` |
| BV002 | Ortsstamm und zuordenbare Strecken-Vor-/Nachbereitung; ohne Ortsstamm `NOT_APPLICABLE` |
| BV003 | vollständige Anfangs- und Endorte; abweichende Orte `FAIL/WARNING` |
| BV005 | unterstützter Planzeitraum und bezahlte Zeit; ohne Planzeitraum `SKIP` |
| BV007-START | Dienste mit Beginn; bei erfüllter Grenze `PASS` |
| BV007-SPLIT | Teilungsstatus in Metadaten bzw. Legacy-Migration; ohne Status `SKIP` |
| BV010 | ausdrücklich klassifizierte unbezahlte Pause; ohne solche Pause `NOT_APPLICABLE` |
| BV012 | ausdrücklich klassifizierte unbezahlte Pause mit vollständigen Zeiten; sonst `NOT_APPLICABLE` bzw. bei fehlenden Zeiten `SKIP` |
| BV014 | ausdrücklich klassifizierte unbezahlte Pause; ohne solche Pause `NOT_APPLICABLE` |

## 5. Tagesart-Datenfluss

Die Tagesart wird nicht geraten. Sie wird nur ausgegeben, wenn der vorhandene
Matcher sie auf `matching.validity.dayType` (oder kompatibel
`matching.validity.scheduleDayType`) bereitstellt.

Beim geprüften JNV-Einzel-PDF ohne Begleitdokument existierte kein Matcher-Ergebnis;
`Tagesart: unbekannt` ist daher weiterhin korrekt. Eine Tagesart aus Dateiname oder
Titel wurde nicht ergänzt.

## 6. Check Explorer und Dienstnummern

Besonders BV003 liefert betroffene Dienste im Check-Vertrag als Canonical-Service-IDs.
Vorher konnte eine solche interne Kennung in der Benutzeroberfläche erscheinen.
Explorer und Dashboard erhalten jetzt den vorhandenen CanonicalSchedule als reinen
Anzeige-Kontext. Nur eine erfolgreiche ID-Auflösung führt zu einer sichtbaren
Dienstnummer. Detail- und Filteransicht verwenden dieselbe aufgelöste Nummer.

Der Reset wurde im Browser geprüft: `BV003` filtert auf einen Eintrag, anschließend
stellt „Filter zurücksetzen“ alle neun JNV-Check-Ergebnisse wieder her.

## 7. JES/JNV- und Browser-Acceptance

| Quelle | Ergebnis |
| --- | --- |
| JNV PDF `tests/fixtures/jnv-schedule.pdf` | 62 Canonical-Dienste; Review Dashboard zeigt 52 tatsächlich von BV003 benannte Dienste als Warnung, 0 kritisch, 0 unauffällig. Prüfbericht und Explorer zeigen denselben einen `FAIL/WARNING`; Explorer zeigt ausschließlich echte Dienstnummern. |
| JES PDF `tests/fixtures/jes-schedule.pdf` | Profil erkannt; leerer JES-Basisreport bleibt ohne erfundene Warnung (alle Dashboard-Kennzahlen 0). |
| Mobile 390 px | Review Dashboard, Prüfbericht und Explorer haben jeweils keinen horizontalen Überlauf; Tabellen bleiben in ihren vorgesehenen Scroll-Containern. |

Der lokale Browserlauf zeigte keine JavaScript-Fehler.

## 8. Tests

Neu bzw. erweitert:

- `tests/phase8-3-review-report-check-explorer.test.js`
- `tests/review-dashboard.test.js`
- `tests/check-explorer.test.js`
- `tests/phase3i35-report-live-context.test.js`
- `tests/phase3i34-report-ui.test.js`

`npm test` (außerhalb der Sandbox): **2.244 bestanden, 0 Fehler, 0 Skips**.

Hinweis: Der erste Lauf innerhalb der Sandbox meldete drei Smoke-Test-Fehler, weil
deren lokaler HTTP-Testserver dort nicht gebunden werden konnte. Der identische
vollständige Lauf außerhalb der Sandbox bestand vollständig. PDF.js-Canvas- und
Standardfont-Warnungen bleiben bekannte Node-Testumgebungswarnungen und verursachten
keine fehlgeschlagenen Tests.

## 9. Verbleibender Fachklärungsbedarf

- Der JNV-Einzel-PDF-Lauf hat ohne Begleitdokument keine Matcher-Tagesart. Das ist
  bewusst weiterhin „unbekannt“, bis ein vorhandenes Matcher-Ergebnis vorliegt.
- Die Review-Tabelle enthält derzeit Status- und Checkkennzahlen, aber keine
  zusätzlichen Beginn-/Ende-/Arbeitszeitspalten. Dafür wurde in dieser Bereinigung
  kein neues Anzeigeformat oder Berechnungsmodell eingeführt.
- Die große BV003-Liste im geprüften JNV-Plan ist fachlich eine echte Abweichung
  Anfangs-/Endort je betroffenen Dienst; ihre zugrunde liegende Regel wurde nicht
  verändert.
