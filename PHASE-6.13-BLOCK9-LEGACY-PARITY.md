# Phase 6.13 – Block 9 Legacy Parity Audit und Wiederherstellung

## 1. Legacy-Soll

Block 9 heißt in der ursprünglichen PWA **„Dienste nach Linie/Kurs“**. Er
beantwortet für den BR die Frage: Welche Dienstabschnitte bedienen welche
Linie/Kurs-Kombination, zu welcher Zeit und zwischen welchen Orten?

Legacy-Struktur:

1. Überschrift `Dienste nach Linie/Kurs:`;
2. Gruppen nach numerisch sortierter Linie/Kurs-Kombination;
3. innerhalb jeder Gruppe nach Abfahrtszeit sortierte Detailzeilen;
4. je Zeile `ID`, Beginn, Anfangsort, Ende und Endort;
5. sofern vorhanden: der nächste zeitlich folgende Abschnitt derselben
   Dienst-ID als Übergabehinweis.

Der Legacy-Block enthält keine Summen, keine Grenzwerte, keine Warnungen und
keine BV- oder Verstoßbewertung. Ohne Linie/Kurs bleibt lediglich die
Überschrift sichtbar.

## 2. Aktueller Zustand vor der Änderung

Die Routenprojektion war fachlich vorhanden, der Renderer reduzierte sie jedoch
auf eine kommagetrennte Dienst-ID-Liste je Gruppe. Dadurch fehlten die für die
Legacy-Aussage wesentlichen Zeit- und Ortsdetails. Der Leerfall verwendete
zusätzlich einen nicht-legacynahen Ersatztext.

## 3. Datenflussanalyse

`CanonicalSchedule.services[].activities`

`→ groupLegacyRoutes`

`→ legacy.routes`

`→ renderRoutes → #route-result`

| Feld / Verhalten | Bewertung | Befund |
| --- | --- | --- |
| Linie/Kurs | A | vorhandene Legacy-Routengruppe |
| Dienstnummer | A | vorhanden je Aktivität |
| Abfahrts-/Ankunftszeit | B → A | vorhanden, zuvor nicht angezeigt |
| Anfangs-/Endort | B → A | vorhanden, zuvor nicht angezeigt |
| Sortierung | A | Gruppen numerisch, Einträge nach Abfahrtszeit |
| nächster Dienstabschnitt | B → A | aus bestehender Aktivitätenfolge projiziert |
| Summen/Warnungen/Bewertungen | A | im Legacy-Soll nicht vorhanden |
| Leerfall | B → A | nur Legacy-Überschrift statt Ersatzmeldung |

Die zuvor etablierte RouteIdentity-Unterstützung bleibt unverändert: Sie kann
vorhandene strukturierte JNV-Linie/Kurs-Identitäten gruppieren. Die Renderer-
Änderung ergänzt dafür keine neue Erkennung oder Fachregel.

## 4. Änderungen

- `groupLegacyRoutes` übergibt den bereits vorhandenen direkt folgenden
  Aktivitätenabschnitt als reine Projektion an den Renderer.
- `renderRoutes` zeigt die ursprüngliche gruppierte Detaildarstellung wieder
  an.
- Es wurden keine Parser, CanonicalSchedule-Felder, JNV-/JES-Regeln oder
  Fachregeln geändert.

## 5. Tests

Neu: `tests/phase6-13-block9-legacy-parity.test.js`.

Abgedeckt sind:

- Gruppierung nach Linie/Kurs;
- numerische Gruppen- und Abfahrtszeitsortierung;
- Zeit-, Orts- und Folgeabschnitt-Details;
- der Legacy-Leerfall;
- JES-Excel/PDF-Parität;
- vorhandene JNV-Linie/Kurs-Daten ohne automatische Bewertung.

Gezielter Lauf: 12 bestanden, 0 Fehler. Vollständige Regression: `npm test`
mit 2.212 bestandenen Tests, 0 Fehlern und 0 Skips. Die bekannten
PDFJS-Canvas-/Standardfont-Hinweise der Node-Testumgebung traten auf, ohne ein
Testergebnis zu beeinflussen.

## 6. Offene Punkte

Keine für die Block-9-Darstellung. Die fachliche Aussage bleibt eine
Information über Dienste nach Linie/Kurs; Fahrzeit-, Umlauf-, Wagenkarten- und
BV-Bewertungen sind bewusst nicht Teil dieses Blocks.
