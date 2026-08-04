# Identity Normalization Foundation (WP23)

Additive Grundschicht für die einheitliche Kennungs-Repräsentation. Sie stellt die
Domänenobjekte **RouteIdentity** und **ServiceIdentity** sowie die **zentrale
Normalisierung** bereit. Sie stellt **keine** bestehende Auswertung um, ändert
keine bestehende API, UI, Check- oder Legacy-Logik und ist rückwärtskompatibel.

Grundlage/Entscheidung: `docs/domain-model-route-service-identity.md`.

## Neue Dateien

| Datei | Inhalt |
|---|---|
| `js/v2/identity/route-identity.js` | `createRouteIdentity`, `ROUTE_IDENTITY_KINDS`. Feld: `{ type, raw, line, course, trip, kind, normalizedKey }`. Beschreibt **nur** den Fahrweg. |
| `js/v2/identity/service-identity.js` | `createServiceIdentity`. Feld: `{ type, raw, dienst, umlauf, normalizedKey }`. Beschreibt **nur** Dienst/Umlauf. |
| `js/v2/identity/identity-normalization.js` | `normalizeCircuitIdentity(raw, context)` + `attachCircuitIdentities(schedule, context)`. **Einziger** Ort der Notationsinterpretation. |
| `tests/identity-normalization.test.js` | Unit-Tests der vier Formate, Äquivalenz, Attach, Rückwärtskompatibilität. |

## Zentrale Normalisierung — die vier unterstützten Formate

`normalizeCircuitIdentity(raw)` liefert `{ routeIdentity, serviceIdentity }` mit
**höchstens einem** belegten Objekt. Interpretation erfolgt ausschließlich hier
(Format-Deskriptoren), nicht verstreut.

| Eingabe | Betrieb | Ergebnis | Felder | normalizedKey |
|---|---|---|---|---|
| `12/1` | Alt JNG | RouteIdentity | line=12, course=1, kind=LINE_COURSE | `LC:12\|1` |
| `12100` | Neu JNG/BEU | RouteIdentity | line=12, course=1, kind=LINE_COURSE | `LC:12\|1` (identisch zu `12/1`) |
| `412/16` | JES Wagenkarte | RouteIdentity | line=412, trip=16, kind=LINE_TRIP | `LT:412\|16` |
| `7511` | JES Übergang | ServiceIdentity | dienst=751, umlauf=1 | `DU:751\|1` |

Sonderfälle: leere Kennung → beide `null`; unbekanntes, nicht-leeres Format →
`RouteIdentity` mit `kind: 'UNKNOWN'`, `raw` erhalten, `normalizedKey: null`
(nichts geht verloren).

`normalizedKey` ist mit dem `kind` präfigiert, damit `LINE_COURSE`, `LINE_TRIP`
und `DIENST_UMLAUF` (Service) nie kollidieren; verglichen wird nur innerhalb
desselben Präfixes. `12/1` und `12100` ergeben denselben Schlüssel und gelten damit
als äquivalent.

## Bereitstellung im CanonicalSchedule (additiv)

`attachCircuitIdentities(canonicalSchedule, context)` gibt ein **neues**
CanonicalSchedule zurück, dessen Aktivitäten zusätzlich `routeIdentity` und
`serviceIdentity` tragen. Die Eingabe wird nicht mutiert, kein bestehendes Feld
entfernt. Die Funktion ist bewusst **nicht** in bestehende Builder oder
Auswertungen eingebunden — das Verdrahten ist Sache eines späteren Arbeitspakets.

## Bewusst nicht verändert

`AnalysisCore`, `CheckRunner`, `Review Dashboard`, `Check Explorer`,
`Legacy Migration`, PDF-/Excel-Builder, UI, BV-Checks — alle unverändert. Kein
bestehender Auswertungsblock wurde umgestellt.

## Kontext-Parameter

`normalizeCircuitIdentity`/`attachCircuitIdentities` akzeptieren ein optionales
`context` (`operator`, `source`). Heute disambiguiert das Notationsformat die vier
Fälle allein; `context` ist für eine spätere betriebsspezifische Deskriptor-Auswahl
vorgesehen, ohne die Interpretation aus diesem Modul herauszulösen.

## WP24 — Integration in die Importpfade

Die Anreicherung wird **genau einmal je Importpfad**, am fertig aufgebauten
CanonicalSchedule, aufgerufen:

| Importpfad | Producer | Aufrufstelle |
|---|---|---|
| PDF | `js/v2/pdf/canonical-schedule-builder.js` | `attachCircuitIdentities` am Ende von `buildCanonicalSchedule` |
| Excel (alt & 10-Spalten) | `js/v2/excel/excel-canonical-adapter.js` | `attachCircuitIdentities` am Ende von `adaptExcelRowsToCanonicalSchedule` |

Damit trägt **jeder** CanonicalSchedule automatisch `routeIdentity`/`serviceIdentity`
— unabhängig davon, ob die Quelle Excel oder PDF war. Bestehende Felder bleiben
unverändert; je Aktivität kommen ausschließlich die zwei Identity-Felder hinzu.
Keine bestehende Komponente wertet `circuitNumber` neu aus — die einzige
Interpretation bleibt in diesem Modul.

**Wagenkarten:** erzeugen heute **keinen** CanonicalSchedule (sie werden als
`ReferenceDataSource` / `WagenkartenReferenceValidationReport` geladen). Es gibt
daher keinen Integrationspunkt — auftragsgemäß **nicht implementiert, nur
dokumentiert**. Sobald ein Wagenkarten-Pfad einen CanonicalSchedule erzeugen sollte,
wäre `attachCircuitIdentities` dort analog am Abschlusspunkt aufzurufen.
