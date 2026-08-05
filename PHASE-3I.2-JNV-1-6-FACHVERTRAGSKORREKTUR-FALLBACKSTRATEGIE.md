# Phase 3I.2 – JNV-1/6-Fachvertragskorrektur und Fallback-Datenstrategie (Abschluss)

**Stand:** 2026-08-01 · **Nur Vertragskorrektur, Bestandskorrektur, Datenstrategie und
Kandidatenvertrag. KEIN 1/6-Algorithmus, kein CheckModule, keine Runner-Registrierung, keine UI,
kein Commit.** Branch `master`, HEAD `5d13adc4`.

## 1. Ausgangslage
Phase 3I.1 lieferte den ersten 1/6-Fachregelvertrag mit **19 offenen Pflichtparametern** und dem
Gesamtstatus **NOT_READY** (fehlende Haltestellenabstände, fehlendes Kombifahrer-Merkmal, keine
Wendezeit-Entität). Inzwischen sind mehrere dieser Fragen betrieblich verbindlich geklärt.

## 2. Neue verbindliche Fachangaben
1. **Distanz pauschal je Organisation:** JNV → `below_3000m`, JES → `above_3000m`; keine
   Entfernungsberechnung, keine Geodaten-/Fahrzeit-/Namensheuristik.
2. **Kombifahrer:** individueller Nachweis **nicht erforderlich**; Bus **und** Straßenbahn werden
   nach der Fahrpersonalverordnung geprüft; kein Fahrer-/Personenmerkmal.
3. **Tagesart-Default:** „Samstag" → Samstag; „Sonntag"/„Sonn- und Feiertag" → Sonn-/Feiertag;
   **ohne** Angabe → Montag–Freitag; kein `unknown` bei sicher erkanntem JNV-Plan.
4. **Tarifabsenkung:** bei JNV **ausnahmslos** 10 + 1 = 11 Minuten; **keine** 8-Minuten-Absenkung.
5. **1/6-Formel:** Gesamtdauer des Dienstes − sämtliche Nichtfahrzeiten = vorgesehene Lenkzeit;
   erforderliche anrechenbare Wendezeit = vorgesehene Lenkzeit / 6; Prüfung: Summe anrechenbarer
   Wendezeiten ≥ vorgesehene Lenkzeit / 6.
6. **Anrechenbare Wendezeit (Stand 3I.2b, verbindlich entschieden):** beobachtete Spanne ≥ 11
   Minuten (= mindestens 10 Minuten Wendezeit + 1 technische Minute). Ist die Mindestspanne
   erreicht, wird die **vollständige beobachtete Spanne** angerechnet — **einschließlich** der
   technischen Minute. Unter 11 Minuten → **0** anrechenbar.
   Beispiele: **10 → 0**, **11 → 11**, **15 → 15**, **20 → 20**.
   Ausdrücklich **verworfen**: Abzug der technischen Minute, pauschale Anrechnung von nur 10
   Minuten, tarifliche 8-Minuten-Regel.

## 3. Scope und Nicht-Ziele
Umgesetzt: Korrektur von `jnv-one-sixth.v1.json`, kontrollierte Bestandskorrektur von
`jnv.v1.json`, Kandidatenvertrag, Tests, dieses Dokument. **Nicht** umgesetzt: 1/6-Algorithmus,
CheckModule, CheckRunner-Registrierung, UI/Explorer, Session, Matching, Timeline/Projection,
BV008-Änderung, Commit.

## 4. Distanzvereinfachung
`stopDistanceStrategy = organization_default`, `stopDistanceCategoryJnv = below_3000m`,
`stopDistanceCategoryJes = above_3000m`, `stopDistanceComputationRequired = false`. Der Grenzwert
3000 m bleibt dokumentiert, wird aber **nicht** gemessen. Damit entfallen die 3I.1-Blocker
`stopDistanceDataSource` und `stopDistanceAggregationScope` **vollständig** — die zuvor fehlenden
Entfernungsdaten werden nicht mehr benötigt.

## 5. Kombifahrer
`combinedDriverRequirement = not_required`, `assessmentBasis = fahrpersonalverordnung`. Der
Parameter `requiresCombinedDriver` und die offene Frage `combinedDriverEvidence` sind **entfernt**.
Es werden **keine** Personen-, Personal- oder Fahrermerkmale benötigt oder verarbeitet.

## 6. Tagesart-Default
`defaultDayType = MON_FRI` (confirmed), `explicitSaturdayLabelDayType = SATURDAY`,
`explicitSundayOrHolidayLabelDayType = SUNDAY_HOLIDAY`, `allowedDayTypes = [SATURDAY,
SUNDAY_HOLIDAY]`. Die 3I.1-Blocker `dayTypeEvidence` und `holidayTreatment` sind damit **gelöst**:
Sonntag und Feiertag werden fachlich gleich behandelt, ein Kalendervertrag wird **nicht** benötigt.
Hinweis: die Ableitung „kein Label → Mo–Fr" ist eine **Vertragsregel**, keine Dateinamens-Heuristik.

## 7. 8-Minuten-Korrektur (Bestandskorrektur)
**Vorprüfung:** `grep` über das gesamte Repo zeigt, dass **kein produktives Modul**
`organizations/jnv.v1.json` liest; einziger Konsument ist `tests/phase2-rule-config.test.js`, und
dieser prüft ausschließlich `tariffReducedAutoActivate === false` — **nicht** den Wert 8. Die
Korrektur ist damit verhaltensneutral und wurde durchgeführt:

| | vorher | nachher |
|---|---|---|
| `tariffReducedMinutes` | `8` / `confirmed` / `minutes` | `null` / `confirmed` / `none` |
| `tariffReducedApplicable` | – | `false` / `confirmed` (neu) |
| `tariffReducedAutoActivate` | `false` | `false` (unverändert) |

Da das eingefrorene Statusvokabular nur `confirmed|provisional|open` kennt, wird „not applicable"
schema-konform als **bestätigter Nullwert plus expliziter `tariffReducedApplicable: false`-Flag**
abgebildet (kein `open`, denn die Frage ist **entschieden**, nicht offen). Ein neuer Test sichert
zusätzlich ab, dass weiterhin kein produktives Modul diese Datei liest.

## 8. 1/6-Formel
`plannedDrivingTimeFormula = duty_duration_minus_all_non_driving_time` ·
`requiredCreditableTurnaroundFormula = planned_driving_time_divided_by_6` ·
`comparisonFormula = sum_creditable_turnaround_minutes_at_least_required` ·
`aggregationScope = duty` · `referencePeriod = single_duty`. Damit sind die 3I.1-Blocker `formula`,
`drivingTimeBasis`, `aggregationScope` und `referencePeriod` **gelöst**.

## 9. Nichtfahrzeiten
`nonDrivingTimeCategories = [turnaround, standing_time, preparation_time, closing_time,
other_non_driving_time]` (Wende-, Stand-, Aufrüst-, Abrüst- und sonstige Nichtfahrzeiten).
**Leerfahrten** sind nach dieser Formel keine Nichtfahrzeit; `deadheadTreatment =
counts_as_driving_time` ist deshalb als **`provisional`** gesetzt — es folgt aus der bestätigten
Formel, wurde aber nicht ausdrücklich bestätigt.

## 10. Wendezeitvertrag (Stand 3I.2b)
`minimumCreditableMinutes = 10`, `technicalMinutes = 1`, `minimumObservedSpanMinutes = 11`,
`belowMinimumCreditedMinutes = 0`, **`creditingMethod = full_observed_span`**,
`plainGapCountsAsTurnaround = false`, `multipleTurnaroundHandling = sum_of_creditable_turnarounds`.
Rechenvertrag:
```
observedSpanMinutes <  11  →  creditedMinutes = 0
observedSpanMinutes >= 11  →  creditedMinutes = observedSpanMinutes
```
Weiterhin **offen**: `turnaroundEvidence` (woran eine Wendezeit technisch erkannt wird) und
`blockBreakRelationship`.

## 11. Technische Minute (eindeutig, 3I.2b)
Die technische Minute ist **Voraussetzung** für die Mindestspanne von 11 Minuten und wird bei
erreichter Mindestspanne **mit angerechnet**; sie wird **nicht** von der beobachteten Wendezeit
abgezogen (`technicalMinuteIncludedInCreditedDuration = true`, `technicalMinuteDeducted = false`,
`flatRateCreditingMinutes = null`). Das frühere, missverständliche Feld
`technicalMinutesCountAsRecovery` wurde **entfernt**, damit daraus kein rechnerischer Abzug
abgeleitet werden kann. `tariffReductionApplicable = false`, `tariffReductionMinutes = null` — bei
JNV gibt es keine 8-Minuten-Variante.

## 12. Primärquelle Umlauftafel
`sourcePriority = [umlauftafel, schedule_structured, schedule_fallback]`,
`umlauftafelIsPrimary = true`, `scheduleMayNotOverrideUmlauftafel = true`,
`doubleCountingForbidden = true`, `insufficientDataResult = INCONCLUSIVE`. Der Dienstplan darf
**ergänzen**, aber die feineren Umlauftafeldaten **nicht überschreiben**; es wird **nie** doppelt
gezählt.

## 13. Dienstplan-Fallback
Ohne Umlauftafel darf der Dienstplan als **gröbere** Grundlage dienen (`schedule_fallback`). Der
Fallback wählt nur den **Datenpfad** und markiert Prüfbedarf — er erzeugt **kein** Ergebnis.

## 14. Blockpausen-Indiz
`noExplicitBlockPause` ist definiert als **ausdrücklich fehlende dargestellte Blockpause** — nicht
„keine Pause überhaupt"; eine Dienstunterbrechung oder normale Standzeit ist **keine** Blockpause.

> **Empirischer Blocker:** In der realen JNV-Pipeline ist `activityType` bei **allen 656**
> Aktivitäten **nicht gesetzt** (`(none)`); es gibt heute **keine** Aktivitätsklassifikation.
> Damit ist die Abwesenheit einer Blockpause **nicht unterscheidbar** von fehlender Klassifikation.
> Gemäß §11 der Vorgabe gilt deshalb: **`inconclusive`, nicht `probable`** — abgesichert über die
> Warnung `BLOCK_PAUSE_ABSENCE_NOT_PROVABLE`.

## 15. Bezahlzeit-Indiz
`paidTimeEqualsDutyTime` ist technisch berechenbar: `service.begin`/`service.end` (jeweils mit
`minutesSinceStartOfDay`) und `service.paidTime.minutes` sind real für **62 von 62** Diensten
vorhanden; die Dienstspanne ist für alle 62 berechenbar. Das Indiz **diskriminiert** auch: nur
**5 von 62** Diensten haben `paidTime == Dienstspanne`; die übrigen zeigen typischerweise eine
Differenz von 30 Minuten (Hinweis auf eine implizit abgezogene unbezahlte Blockpause — als
**Beobachtung** dokumentiert, **nicht** als Ableitung verwendet). Offen bleibt bewusst
`paidTimeComparisonTolerance`: **keine Toleranz und keine Rundung wurden erfunden**;
Mitternachtsüberschreitung ist über `minutesSinceStartOfDay` behandelbar.

## 16. Kandidatenstatus
**Entscheidung:** ein **kleiner reiner Vertrag als Code** —
`js/v2/rules/one-sixth-candidate-contract.js`. Begründung: die geschlossenen Vokabulare
(`probable | not_indicated | inconclusive`, Quellen, Evidenz, Warnungen) und die Regel
„unbeweisbar → `inconclusive`" sind **testbar** und verhindern, dass eine spätere Phase eigene
Statuswerte erfindet; in reinem JSON wäre das nicht prüfbar. Der Vertrag **wertet nichts aus**:
keine Regelbewertung, kein Ergebnis, kein Datenzugriff, keine Speicherung, kein Netzwerk. Die
Factory verwirft unbekannte Werte, statt sie zu übernehmen.

## 17. Datenreife-Matrix (neu bewertet)

| Fachfeld | Quelle | Status |
|---|---|---|
| Organisation JNV, Modus Bus/Tram | Profil / Umlauftafel | AVAILABLE_EXACT |
| Distanzkategorie JNV `<3 km` / JES `>3 km` | Organisationsregel | AVAILABLE_EXACT |
| Kombifahrer **nicht erforderlich** | Vertrag | AVAILABLE_EXACT |
| Default-Tagesart Mo–Fr + Sa/So-Override | Vertrag + Titel | AVAILABLE_EXACT |
| Linienzuordnung, Linie 18 | Dienstplan + Umlauftafel | AVAILABLE_EXACT |
| 10 + 1 = 11, 8-Minuten nicht anwendbar | Vertrag | AVAILABLE_EXACT |
| 1/6-Formel, Nichtfahrzeit-Kategorien | Vertrag | AVAILABLE_EXACT |
| Haltestellenfolge | Umlauftafel (3980 benannt) | AVAILABLE_EXACT |
| **Dienstgesamtdauer** (begin/end) | CanonicalSchedule (62/62) | **AVAILABLE_EXACT** |
| **Bezahlte Zeit** (`paidTime.minutes`) | CanonicalSchedule (62/62) | **AVAILABLE_EXACT** |
| Sonn-/Feiertagskennung | Titel/Validity | AVAILABLE_PARTIAL |
| Nichtfahrzeiten (Kategorien) | Projektion / Umlauftafel | AVAILABLE_PARTIAL |
| explizite Pausen | Projektion | AVAILABLE_PARTIAL |
| Dienstunterbrechungen | Hardening (real 0) | AVAILABLE_PARTIAL |
| Nachtschicht ab 19:20 | Dienstbeginn + Config | DERIVABLE_WITH_APPROVED_RULE |
| `paidTimeEqualsDutyTime` | begin/end + paidTime | DERIVABLE_WITH_APPROVED_RULE (Toleranz offen) |
| 1/6-Kandidatenstatus ohne Umlauftafel | Fallback-Indizien | DERIVABLE_WITH_APPROVED_RULE |
| anrechenbare Wendezeit**dauer** (Rechenregel) | Vertrag (3I.2b) | AVAILABLE_EXACT |
| **Blockpause / `noExplicitBlockPause`** | `activityType` real nie gesetzt | **NOT_RELIABLY_DERIVABLE** |
| **Wendezeit-Erkennung** (Beginn/Ende/Dauer) | keine Entität | **NOT_RELIABLY_DERIVABLE** |
| Erholungsqualität unbekannter Zeiten | – | NOT_RELIABLY_DERIVABLE |
| Fahrer-/Fahrzeugwechsel | Flags real nie gesetzt | NOT_RELIABLY_DERIVABLE |
| Haltestellenabstände (Messwert) | **nicht mehr erforderlich** | entfällt |
| Kombifahrer-Merkmal | **nicht mehr erforderlich** | entfällt |
| Feiertagskalender | **nicht mehr erforderlich** | entfällt |

**Gesamtstatus: PARTIALLY_READY.**
Begründung: Geltungsbereich, Tagesart, Formel und Dienst-/Bezahlzeitdaten sind belastbar; es fehlen
weiterhin die **technische Wendezeiterkennung** (`turnaroundEvidence`) — zwingend für ein
definitives Ergebnis. Drei frühere MISSING-Blocker sind **entfallen**, keiner ist hinzugekommen.

## 18. Anrechnungsregel (geschlossen, Stand 3I.2b)
Die Anrechnung ist **verbindlich entschieden** und damit **kein offener Punkt mehr**:

| beobachtete Spanne | anrechenbar |
|---|---|
| 10 Minuten | **0** |
| 11 Minuten | **11** |
| 15 Minuten | **15** |
| 20 Minuten | **20** |

`creditingMethod = full_observed_span`: ab der Mindestspanne von 11 Minuten zählt die
**vollständige beobachtete Wendezeit**, **einschließlich** der technischen Minute. Ausdrücklich
**verworfen und nirgends mehr im Vertrag enthalten**: ein Abzug der technischen Minute, eine
pauschale Anrechnung von nur 10 Minuten und die tarifliche 8-Minuten-Regel.

## 19. Freigabegate
`status: draft`, `enabled: false`, `approvedBy: null`. Offene Pflichtparameter: **8**
(3I.1: 19 → 3I.2: 9 → 3I.2b: 8) — `nightShiftStartBasis`, `exceptionLineScope`,
`mixedLineHandling`, `turnaroundEvidence`, `blockBreakRelationship`, `roundingRule`,
`mixedModeHandling`, `paidTimeComparisonTolerance`. Der bestehende Validator blockiert `approved`
weiterhin mit `APPROVED_WITH_OPEN_PARAMETERS` (im Test belegt).

## 20. Tests (40; davon 4 aus 3I.2b)
`phase3i2-one-sixth-contract-correction.test.js` (22): Distanzstrategie je Organisation, keine
Distanzberechnung/Geoheuristik, Kombifahrer nicht erforderlich, Bus+Tram, Mo–Fr-Default mit
Sa/So-Override, 8-Minuten nicht anwendbar, Formel + Nichtfahrzeitkategorien, 1/6, 10+1=11,
0 unterhalb der Mindestspanne, **volle Spanne ab 11 Minuten (10→0, 11→11, 15→15, 20→20)**, kein
Abzug der technischen Minute, keine Pauschale, Summenbildung, Lücke ≠ Wendezeit, Quellpriorität,
Indizien nur Kandidat, Freigabeblockade, gelöste Fragen nicht mehr offen, keine ausführbare Logik.
`phase3i2-jnv-config-correction.test.js` (6): korrigierte Bestandsdatei validiert, kein aktiver
8er-Wert, `not applicable` + kein Auto-Aktivieren, Mindestwerte unverändert, restlicher Vertrag
unberührt, **kein produktiver Konsument** (Repo-Scan).
`phase3i2-one-sixth-fallback-readiness.test.js` (12): geschlossene Kandidatenvokabulare, kein
Ergebnisbegriff/Storage/Netzwerk im Vertrag, Factory/Validator, unbeweisbare Blockpause →
`inconclusive`, Audit-Verankerung, reale Probe (Dienstspanne + Bezahlzeit vorhanden, **keine**
Aktivitätsklassifikation).

## 21. Regression
**616/616 grün** (576 + 40 neu), 0 Skips. Phase 3I.1 (33/33) bleibt grün — die dortige Aussage
„8 Minuten nicht aktiv" gilt weiterhin; zwei 3I.1-Assertions wurden als durch **3I.2b** ersetzt
gekennzeichnet. BV008, Check-/Rule-Architektur, Matching, Timeline, Projection, Session, UI
unverändert.

## 22. Datenschutz
Reine Vertrags-/Metadatenarbeit. Im Bericht stehen nur **Aggregate** (62/62, 5 von 62, typische
Differenz 30 Minuten) — keine Originalzeilen, Zellinhalte, Dienstlisten, PDF-Koordinaten,
Personendaten oder absoluten Pfade im Produktcode; keine Referenzdatei im Repository; die Proben
liefen read-only außerhalb des Repos.

## 23. Bekannte Grenzen
- **Wendezeiterkennung fehlt weiterhin** — ohne sie ist kein definitives 1/6-Ergebnis möglich.
- **Blockpausen-Indiz heute nicht nutzbar** (keine Aktivitätsklassifikation) → `inconclusive`.
- Die **Anrechnungsregel ist geschlossen** (volle Spanne ab 11 Minuten); offen bleibt allein, woran
  eine Wendezeit technisch **erkannt** wird.
- `deadheadTreatment` nur `provisional` (Folge der Formel, nicht ausdrücklich bestätigt).
- Kein realer **Samstags-/Sonntags-** und kein **Straßenbahn**-Referenzsatz.
- Die 30-Minuten-Differenz zwischen Dienstspanne und Bezahlzeit ist eine **Beobachtung**, keine
  freigegebene Ableitung einer Blockpause.

## 24. Nächste Phase
**Phase 3I.3 – Wendezeiterkennung:** (a) verbindliche Definition, woran eine Wendezeit in
Umlauftafel bzw. Dienstplan technisch erkannt wird (`turnaroundEvidence`) — der einzige verbleibende
fachliche Kernblocker, (b) Entscheidung zu Rundung, Linie-18-Geltungsbereich, gemischten
Linien/Modi, Blockpausen-Verhältnis und Bezahlzeit-Toleranz. Optional **3I.3b**: Aktivitäts-
klassifikation im JNV-Parser, damit das Blockpausen-Indiz nutzbar wird. Erst danach **3I.4**
(Regelmodul analog BV008 → Adapter → Orchestrator); die Ergebnisdarstellung ist durch 3H.6 bereits
abgedeckt.

## 25. Commit-Empfehlung (KEIN Commit in dieser Phase)
Betroffene Dateien:
```
js/v2/rules/config/organizations/jnv-one-sixth.v1.json          (geändert)
js/v2/rules/config/organizations/jnv.v1.json                    (geändert, Bestandskorrektur)
js/v2/rules/one-sixth-candidate-contract.js                     (neu)
tests/phase3i2-one-sixth-contract-correction.test.js            (neu)
tests/phase3i2-jnv-config-correction.test.js                    (neu)
tests/phase3i2-one-sixth-fallback-readiness.test.js             (neu)
PHASE-3I.2-JNV-1-6-FACHVERTRAGSKORREKTUR-FALLBACKSTRATEGIE.md   (neu)
DIENSTPLANANALYSE-V1-PHASEN-CHECKLISTE.md                       (geändert)
```
Vorgeschlagene Commit-Message:
```
docs(rules): correct the JNV one-sixth contract and add the fallback data strategy

Replace the unmeasurable stop-distance requirement with an organisation default that treats JNV as
below and JES as above three kilometres, drop the combined-driver requirement in favour of the
Fahrpersonalverordnung assessment basis, and default the day type to Monday-Friday with explicit
Saturday and Sunday-or-holiday overrides.

Set the binding planned-driving-time formula as the duty duration minus all non-driving time, the
required creditable turnaround as that driving time divided by six, and the comparison as the sum
of creditable turnarounds against it.

Close the crediting question: a turnaround qualifies from an observed span of eleven minutes, and
from that point the full observed span is credited including the technical minute, so ten minutes
credit nothing while eleven, fifteen and twenty minutes credit eleven, fifteen and twenty. Remove
the ambiguous recovery flag so no deduction of the technical minute and no flat ten-minute crediting
can be derived, and keep turnaround evidence, rounding, line-18 scope, mixed line and mode handling
and the paid-time tolerance open.

Correct the factually wrong eight-minute tariff reduction in the existing JNV configuration to a
confirmed not-applicable value after verifying that no productive module reads that file, and guard
that fact with a repository scan test.

Define the primary Umlauftafel and fallback schedule data strategy with a forbidden double count,
and add a pure candidate contract whose closed vocabulary can select a data path and flag a duty
worth checking but can never express a compliance outcome; an unprovable missing block pause
collapses to inconclusive because the current pipeline classifies no activity type.

Re-assess the data readiness as PARTIALLY_READY, add 36 contract, correction, candidate, readiness
and real-reference tests, and implement no rule, CheckModule, runner registration or UI.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

*Nur Vertragskorrektur, Bestandskorrektur, Datenstrategie und Kandidatenvertrag. Gesamtstatus
**PARTIALLY_READY**; die Anrechnungsregel ist geschlossen, die technische Wendezeiterkennung bleibt
offen. Kein Commit.*
