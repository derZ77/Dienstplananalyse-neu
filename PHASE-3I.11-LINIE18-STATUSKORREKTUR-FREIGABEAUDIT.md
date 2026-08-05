# Phase 3I.11 – Statuskorrektur vollständig ausgenommener Einheiten und Freigabeaudit

**Stand:** 2026-08-02 · Branch `master`, HEAD `2fa399ed` · **Kein Commit. Keine Freigabe. Keine
Aktivierung.** Regelset weiterhin `draft` / `enabled:false` / `approvedBy:null`.

**Freigabeaudit-Ergebnis dieser Phase: `BLOCKED`** (siehe §16–§19).

> **Nachtrag Phase 3I.12 (2026-08-02):** Beide hier blockierenden Fachfragen sind vom Nutzer
> verbindlich entschieden — Nachtschichten fallen **zusätzlich** unter die 1/6-Regel,
> Wochenend-Nachtschichten werden **regulär** geprüft, Leerfahrten zählen **vollständig** als
> Lenkzeit. `deadheadTreatment` ist damit `confirmed`. Der Blocker aus §18/§19 ist **aufgehoben**;
> maßgeblich ist `PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md`.
>
> **Nachtrag Phase 3I.13 (2026-08-02):** Auch die dort verbliebene Aktivierungsauflage (Leerfahrt
> ohne Linie) ist entschieden und umgesetzt — siehe
> `PHASE-3I.13-DEADHEAD-LINE-CLASSIFICATION-ABSCHLUSS.md`.

## 1. Ausgangslage
Aus Phase 3I.10b: Steht eine vollständig ausgenommene Linie-18-Einheit **neben** einer regulären
Einheit, wurde sie als `PASS` mit `drivingMinutes: 0` und `requiredMinutes: 0` ausgegeben. Eine
Einheit, die nie im Anwendungsbereich war, erschien damit als bestandene Prüfung.

## 2. Scope / Nicht-Ziele
Geändert: `js/v2/analysis/one-sixth-rule.js`, `js/v2/analysis/one-sixth-validation.js`, Checkliste;
neu: drei `tests/phase3i11-*.test.js` und dieses Dokument. **Nicht** angefasst:
`jnv-one-sixth.v1.json`, Orchestrator, Driving Projection, Turnaround Detection, Joint Timeline,
BV008, CheckAdapter, CheckRunner, Rule Engine, Session, Bootstrap, `index.html`, Explorer,
`server.js`, Package-Dateien. Keine Freigabe, keine Aktivierung, keine Fachparameteränderung.

## 3. Der §7-Befund
Bestätigt und reproduziert: zwei Einheiten (`18`, 396 min) und (`5`, 396 min) in einem Lauf →
`A: PASS 0/0`, `B: FAIL 396/66`. Die reguläre Einheit rechnete korrekt; die ausgenommene bekam eine
Scheinquote.

## 4. Technische Ursache
Die Eignungsprüfung erkennt den Fall **bereits**: `inspectCirculation()` führt
`evaluableSegmentCount` und liefert je Umlauf `NOT_APPLICABLE` mit `ALL_SEGMENTS_EXCEPTED`. Verloren
ging der Status an **zwei** Stellen:

1. **Dokumentebene:** Der Kurzschluss in `evaluateOneSixthRule()` greift nur, wenn **jede** Einheit
   `NOT_APPLICABLE` ist (`.every(...)`). Im gemischten Dokument läuft die Bewertung weiter.
2. **Einheitenebene:** An `evaluateCirculation()` wurden aus dem Eignungsergebnis nur
   `exceptedSegmentIndexes` und `turnaroundAmbiguous` durchgereicht — **nicht der Status der
   Einheit**. Dort ergab die segmentbereinigte Basis dann `0` → `ceil(0/6) = 0` → `0 ≥ 0` → `PASS`.

Die Information war also vorhanden und wurde an der Grenze zwischen Eignung und Bewertung fallen
gelassen. Genau dort wurde korrigiert — nicht im Adapter, nicht im Runner, nicht im Top-Level-Status.

## 5. Statuskorrektur
`evaluateCirculation()` erhält jetzt `eligibilityStatus` und `evaluableSegmentCount` der Einheit und
gibt **vor jeder Quotenarithmetik** zurück:

```
eligibilityStatus === NOT_APPLICABLE  →  status NOT_APPLICABLE
                                         Grund NO_EVALUABLE_SEGMENTS   (evaluableSegmentCount === 0)
                                         Grund DAY_TYPE_NOT_ELIGIBLE   (sonst)
```

Keine Quotenermittlung aus 0 Minuten, kein PASS, kein FAIL, keine Violation.

**Über die Vorgabe hinaus mitkorrigiert (bewusst, mit Begründung):** Dieselbe Lücke betraf die
Tagesart. Ein Dokument mit einem Nachtdienst und einem gewöhnlichen Mo–Fr-Dienst lieferte für den
Mo–Fr-Dienst nicht nur einen falschen Status, sondern konnte ihn **FAIL** und damit eine
**Scheinverletzung** erzeugen — schwerwiegender als der 0/0-PASS. Die Ursache ist identisch (der
Einheitenstatus wurde nicht weitergereicht), die Korrektur ist dieselbe eine Verzweigung, und §2C
verlangt ausdrücklich „keine Statusübertragung zwischen Einheiten". Eine Teilkorrektur hätte den
gefährlicheren Fall wissentlich offengelassen.

## 6. Result-Shape der ausgenommenen Einheit
```
{ circulationCode, serviceNumber,
  status: 'NOT_APPLICABLE',
  drivingMinutes: null, requiredMinutes: null, deficitMinutes: null,
  creditedMinutes: 0,
  exceptedSegmentCount, exceptedDrivingMinutes, evaluableSegmentCount,
  violations: [], warnings: ['NO_EVALUABLE_SEGMENTS'] }
```
Keine Parallelstruktur: dieselben Felder wie jede andere Einheit, `evaluableSegmentCount` ergänzt
(ohne Eignungsprüfung `null`). Die ausgeschlossene Zeit bleibt über `exceptedDrivingMinutes`
neutral sichtbar — sie ist **nie** Quotenbasis. Der Umlaufweite Grund erscheint zusätzlich als
strukturierte Warnung `{ code, circulationCode }` auf dem Regelergebnis.

## 7. Einheiten-Unabhängigkeit
Belegt für alle fünf geforderten Kombinationen:

| Lauf | Einheit A | Einheit B | Top-Level |
|---|---|---|---|
| nur ausgenommen | NOT_APPLICABLE | — | NOT_APPLICABLE |
| ausgenommen + PASS | NOT_APPLICABLE | PASS | PASS |
| ausgenommen + FAIL | NOT_APPLICABLE | FAIL | FAIL (1 Violation, nur B) |
| ausgenommen + INCONCLUSIVE | NOT_APPLICABLE | INCONCLUSIVE | INCONCLUSIVE |
| zwei ausgenommene | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE |

Zusätzlich getestet: Das Ergebnis der regulären Einheit ist identisch mit und ohne die ausgenommene
Einheit, und die **Reihenfolge** der Einheiten ändert kein Urteil.

**Bewusste Design-Entscheidung:** Sind *alle* Einheiten ausgenommen, greift weiterhin der
Kurzschluss auf Dokumentebene — `services: []`, kein Quotenlauf. Das schützt die bestehende Zusage,
dass ein nicht anwendbares Dokument **keine** Wendezeitdaten benötigt (sonst würde eine fehlende
Turnaround-Erkennung es zu INCONCLUSIVE machen). Der Einheitenstatus ist in diesem Fall über
`evaluateOneSixthEligibility(...).circulations[].status` sichtbar und dort getestet.

## 8. Top-Level-Aggregation
Bestehende Priorität **unverändert**: `FAIL → INCONCLUSIVE → PASS`. Ergänzt: sind weder FAIL noch
INCONCLUSIVE noch PASS vorhanden, ist das Gesamtergebnis **NOT_APPLICABLE** statt PASS. `DISABLED`
bleibt der vorgeschaltete Konfigurationsstatus. Kein neues Statusvokabular.

Bestätigt: NOT_APPLICABLE-Einheiten zählen nicht als PASS, erzeugen keinen Hit, ein vorhandenes FAIL
bleibt FAIL, ein vorhandenes INCONCLUSIVE bleibt INCONCLUSIVE, PASS nur bei mindestens einer
bestandenen anwendbaren Einheit.

## 9. Statistik
`evaluatedServices` zählt jetzt die **tatsächlich bewerteten** Einheiten
(`services.length − notApplicable`); neu ist der Zähler `notApplicableServices` — dieselbe
Zählerarchitektur wie `passedServices` / `failedServices` / `inconclusiveServices`, kein Score, keine
Gewichtung. Invarianten getestet: `evaluated + notApplicable = services.length` und
`passed + failed + inconclusive = evaluated`. Die Summen (`total*Minutes`) übernehmen aus
NOT_APPLICABLE-Einheiten nichts (`null` fällt in der bestehenden `Number.isFinite`-Summe heraus);
alle Werte bleiben endlich, kein NaN, kein Infinity, keine falsche 0 als Messwert.

## 10. Validator
`validateOneSixthEvaluation` lässt jetzt zu und verlangt:
- NOT_APPLICABLE mit `drivingMinutes/requiredMinutes/deficitMinutes = null` (bisher erzwang die
  Unbekannt-Regel aus 3I.7 an dieser Stelle INCONCLUSIVE),
- eine Begründung (`NOT_APPLICABLE_WITHOUT_REASON`, wenn die Warnungsliste leer ist).

Zurückgewiesen werden: `NOT_APPLICABLE_WITH_QUOTA` (Quote trotz Nichtanwendbarkeit),
`VIOLATION_WITHOUT_FAIL` (Violation an einer nicht anwendbaren Einheit) und
`OUTCOME_WITHOUT_EVALUABLE_SEGMENTS` (PASS **oder** FAIL bei `evaluableSegmentCount === 0`, also
genau die alte 0/0-Substitution). `notApplicableServices` wird geprüft, **wenn** vorhanden — ältere
Statistik-Shapes bleiben gültig. Alle bestehenden PASS-/FAIL-/INCONCLUSIVE-Prüfungen sind unverändert.

## 11. Adapter
`one-sixth-check.js` ist **unverändert**. Die bestehende Abbildung war bereits korrekt:
`NOT_APPLICABLE → NOT_APPLICABLE / INFO`, keine Violation, keine Statusumschreibung. Die kleine
`details.services`-Projektion zeigt die ausgenommene Einheit mit `status: NOT_APPLICABLE` und
`drivingMinutes: null`.

## 12. CheckRunner
**Unverändert.** `summary.hitCount` zählt ausschließlich `status === 'FAIL'`; ein
NOT_APPLICABLE-Ergebnis ist damit nie ein Hit. Kein regelspezifisches Wissen im Runner.

## 13. Gemeinsamer CheckReport
Unverändert: ein Report, zwei Ergebnisse, Reihenfolge BV008 → BV015_BV018, `summary.resultCount = 2`,
`errors: []`, BV008 unabhängig. Session, Bridge und Explorer erhalten denselben Report und wissen
weiterhin nichts von der Regel (per Test abgesichert).

## 14. Regression
Alle 1027 bisherigen Tests laufen **unverändert** grün — die Korrektur wirkt ausschließlich auf
Einheiten, die die Eignungsprüfung bereits ausgeschlossen hatte. Explizit nachgeprüft: gemischte
Einheit `792 → 396 → 66`, unbekannte Dauer im ausgenommenen Segment blockiert nicht, unbekannte
Dauer im regulären Segment bleibt INCONCLUSIVE, Ceiling-Rundung, 11-Minuten-Anrechnung,
exact/probable und das Verhalten **ohne** `eligibility` (volle Basis 792/132) sind unberührt.

## 15. Konfigurationsaudit (read-only)
`jnv-one-sixth.v1.json` **unverändert**: `status: draft`, `enabled: false`, `approvedBy: null`,
Open-Count **0**. Der Konfigurationsvalidator akzeptiert ein aktiviertes Regelset — die Freigabe ist
also eine **Entscheidung**, keine technische Lücke. Produktiv liefert die Regel weiterhin
`DISABLED → SKIP/INFO`.

**Audit-Befund:** Ein Parameter außerhalb der Pflichtliste ist weiterhin **`provisional`**:
`calculation.deadheadTreatment = "counts_as_driving_time"`. Er entscheidet, ob Leerfahrten in die
Lenkzeitbasis eingehen, und wirkt damit unmittelbar auf jede Quote. Vor einer Freigabe muss er
bestätigt oder bewusst als vorläufig akzeptiert werden.

## 16. Fachvertragsaudit
Belegt ist die **Grundregel**: „Dienste grundsätzlich **nur am Wochenende** in 1/6. Ausnahmen:
**Nachtschichten** und **Linie 18**." (Nutzerregeln 7 und 8, `PHASE-3I.1-…`, §3, als verbindlich
protokolliert). Der Mo–Fr-NOT_APPLICABLE-Effekt ist damit vertraglich gedeckt.

Belegt ist auch die **Linie-18-Ausnahme**: 3I.8b hält die ausdrückliche Nutzerentscheidung fest —
`affected_segments_only`, „andere Linien im selben Dienst bleiben regulär prüfbar, es gibt keine
pauschale Dienst- oder Umlaufausnahme". Linie-18-Abschnitte werden also **aus** der Regel
herausgenommen.

**Nicht belegt ist die Bedeutung der Nachtschicht-Ausnahme.** Beide Ausnahmen stehen in **einem**
Satz, werden im Code aber mit **entgegengesetzter Wirkungsrichtung** umgesetzt:

| | Bedeutung im Code | Wirkung |
|---|---|---|
| Nachtschicht | Ausnahme **zugunsten** der Geltung | ein Mo–Fr-Nachtdienst **wird** geprüft |
| Linie 18 | Ausnahme **gegen** die Geltung | Linie-18-Abschnitte werden **nicht** geprüft |

Der Parametername `nightShiftIsException: true` ist genauso mehrdeutig wie der Vertragssatz. Beide
Lesarten sind mit dem Wortlaut vereinbar und führen zu **materiell verschiedenen** Ergebnissen. Als
Nebenwirkung ist außerdem nirgends entschieden, wie eine **Samstags-Nachtschicht** zu behandeln ist —
heute wird sie wie jeder Wochenenddienst geprüft, die Nachtschicht ändert dort nichts.

## 17. Mo–Fr-/Nacht-/Linie-18-Geltung
Aktuelles Verhalten, als Test festgenagelt:

| Tagesart | Dienstbeginn | Eignung heute |
|---|---|---|
| Mo–Fr | 19:20 | **PASS** (geprüft) |
| Mo–Fr | 05:00 | NOT_APPLICABLE |
| Samstag | 19:20 | PASS |
| Samstag | 05:00 | PASS |
| beliebig | unbekannt | INCONCLUSIVE |
| Linie-18-Abschnitte | — | aus der Basis entfernt |

Der Code bildet damit **Variante B** ab (nur Wochenend-/Nacht-Dienste), was Nutzerregel 7 wörtlich
entspricht.

## 18. Offene Fachfrage
Nicht still beantwortbar, daher wörtlich gestellt:

> **Frage 1 (Nachtschicht):** Bedeutet „Nachtschichten sind eine Ausnahme", dass eine Nachtschicht
> **zusätzlich in die 1/6-Prüfung fällt** (also auch Mo–Fr geprüft wird), oder dass eine Nachtschicht
> **von der 1/6-Prüfung ausgenommen ist** (also auch am Wochenende nicht geprüft wird)? Der Code
> setzt heute die erste Lesart um.
>
> **Frage 2 (Nachtschicht am Wochenende):** Falls Lesart 1 gilt — soll eine **Samstags- oder
> Sonntags-Nachtschicht** wie jeder andere Wochenenddienst geprüft werden (heutiges Verhalten), oder
> gilt für sie etwas Abweichendes?
>
> **Frage 3 (Leerfahrten):** Sollen **Leerfahrten** in die Lenkzeitbasis der 1/6-Quote eingehen? Der
> Parameter `deadheadTreatment = "counts_as_driving_time"` ist bislang nur **vorläufig**.

## 19. Freigabeaudit-Ergebnis dieser Phase: **`BLOCKED`** — aufgehoben durch Phase 3I.12
Erfüllt: Statuskorrektur grün, alle Tests grün, Pflichtparameter geschlossen (Open-Count 0),
technische Pipeline vollständig, kein Architekturblocker, produktive Regel weiterhin deaktiviert.

Blockierend **zum Zeitpunkt dieser Phase**: die mehrdeutige Bedeutung der Nachtschicht-Ausnahme
(§16/§18, Fragen 1 und 2) sowie der damals vorläufige Parameter `deadheadTreatment` (Frage 3).

**Aufgehoben durch Phase 3I.12:** Alle drei Fragen sind verbindlich beantwortet (Nachtschicht
zusätzlich in der Regel, Wochenend-Nachtschicht regulär, Leerfahrt volle Lenkzeit). Der Auditstatus
lautet seither **`READY_FOR_APPROVAL`** — siehe `PHASE-3I.12-FACHVERTRAGSABSCHLUSS.md`.

## 20. Datenschutz
Die beiden geänderten Produktdateien enthalten keine Speicherung, kein Netzwerk, keine
Dokumentkopien, Originalzeilen, Haltestellenlisten, Datei-/Workbook-/Byte-Objekte, keine absoluten
Pfade und keine Personendaten. Die neuen Felder sind Zahlen, Statusstrings und `null`. Keine
Referenzdatei wurde übernommen; im App-Verzeichnis liegt keine.

## 21. Tests
**48 neue Tests** (16 + 19 + 13), Gesamtsuite **1075/1075** (0 Skips, 0 todo):

- `phase3i11-fully-exempt-unit-status.test.js` (16): Einheitenstatus, fehlende Quote, `null` statt 0,
  keine Violation, Grundcode, sichtbare ausgeschlossene Zeit, mehrere ausgenommene Segmente, der
  tagesartbedingte Zwillingsfall, fünf Validator-Zusagen, unveränderter INCONCLUSIVE-Vertrag.
- `phase3i11-mixed-unit-aggregation.test.js` (19): die fünf Kombinationen, Unabhängigkeit und
  Reihenfolgefreiheit, Aggregationspriorität, Statistik-Invarianten, Adapter-/Runner-Abbildung,
  gemeinsamer Report, vier Regressionszusagen aus 3I.10b.
- `phase3i11-approval-readiness-audit.test.js` (13): Konfigurationsaudit, gespiegelte Default-Werte,
  produktives DISABLED, Validator-Akzeptanz eines freigegebenen Regelsets, die Vertragsbelege, die
  **offene Lesart** als Verhalten festgenagelt, und die Wächter gegen Aktivierung und UI-Wissen.

**Kein bestehender Test musste angepasst werden** — die Korrektur wirkt nur dort, wo bisher gar kein
Testfall existierte.

## 22. Bekannte Grenzen
- Sind alle Einheiten ausgenommen, bleibt `services: []` (§7) — der Einheitenstatus ist dann nur über
  die Eignungsprüfung sichtbar.
- Der **gemischte** Linie-18-Übergang bleibt INCONCLUSIVE (Fachvertrag entscheidet ihn nicht).
- Kandidatenlinien stammen aus der Umlauftafel, Segmentlinien aus dem Dienstplan.
- Kein realer Samstags-/Sonntags- und kein Straßenbahn-Referenzsatz vorhanden; ein realer
  End-to-End-Nachweis mit passender Dienstplan-/Umlauftafel-Paarung steht weiterhin aus.
- Regelset weiterhin `draft` / `disabled` / nicht freigegeben.

## 23. Nächste Phase
**Phase 3I.12 – Klärung der Nachtschicht-Semantik** (Fragen 1–3 aus §18) — **erledigt**, danach
erneutes Freigabeaudit. Eine Aktivierung setzt zusätzlich die fachliche Freigabe (`status: approved`,
`approvedBy`) und den realen End-to-End-Nachweis voraus.

## 24. Commit-Empfehlung (KEIN Commit)
```
js/v2/analysis/one-sixth-rule.js · one-sixth-validation.js
tests/phase3i11-*.test.js (3 neu)
PHASE-3I.11-LINIE18-STATUSKORREKTUR-FREIGABEAUDIT.md · Checkliste
```
`fix(analysis): mark fully exempt JNV units as not applicable`
