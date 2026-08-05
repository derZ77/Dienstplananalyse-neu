# Test-Fixtures – Vertrag (Phase 2)

Versionierte Struktur für anonymisierte oder synthetische Referenzdaten. **Keine
personenbezogenen Produktivdaten.** Die hier enthaltenen Referenzartefakte wurden
für die Tests auf Namen, E-Mail-Adressen, Telefonnummern, Personalnummern und
entsprechende Textmarker geprüft. Sie enthalten Dienst-, Umlauf- und Zeitdaten,
aber keine erkennbaren personenbezogenen Kennungen.

## Erwartete Unterverzeichnisse

```
tests/fixtures/
  jes-schedule.pdf
  jes-acceptance.pdf
  jes-school-acceptance.pdf
  jnv-schedule.pdf
  jnv-umlauftafel.pdf
  legacy-schedule.xlsx
  jes-ten-column-schedule.xlsx
  bus-umlauftafel.xlsx
  tram-umlauftafel.xlsx
  paths.js         # zentraler, relativer Fixture-Zugriff für Tests
  synthetic/       # eindeutig synthetische Mini-Datensätze
```

Der maßgebliche Index ist `manifest.json`. Verzeichnisse ohne freigebbare Datei
werden nur über das Manifest geführt (keine leeren Platzhalter erzwungen).

## Kennzeichnung

- `sourceKind`: `anonymized` · `synthetic` · `contract-only`.
- `status`: `available` · `missing` · `planned` · `restricted`.
- Das **JNV-Hauptdokument** (Stadtbus-PDF, Profil `beu-stadtbus-v1`) ist als
  anonymisierte Testreferenz versioniert.
- Noch fehlende JNV-Bausteine (Umlaufkarte/Companion) tragen `marker`
  `synthetic_contract_only`/`missing_reference` und sind nie `available`.
- „BEU" ist nur eine technische Profil-ID des JNV-Stadtbus-Plans, keine eigene
  Organisation/Dokumentfamilie.

## Regeln

- Keine personenbezogenen Daten aufnehmen.
- Synthetische Daten immer als `synthetic`/`contract-only` kennzeichnen.
- Erfundene JNV-Umlaufkarten-Beispiele sind kein Ersatz für eine echte Referenz.
