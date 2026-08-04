# Test-Fixtures – Vertrag (Phase 2)

Versionierte Struktur für anonymisierte oder synthetische Referenzdaten. **Keine
echten personenbezogenen Produktivdaten.** Die realen Referenz-PDFs (JES/JNV) liegen
außerhalb des Repos (`~/Downloads`) und müssen vor einer Versionierung anonymisiert
werden.

## Erwartete Unterverzeichnisse

```
tests/fixtures/
  legacy-excel/    # anonymisierte/synthetische Legacy-Excel-Dienstpläne (JNV-MICROBUS)
  jes/             # anonymisierte JES-Dienstplan-PDFs (Profil jes-regionalbus-v1)
  jnv/             # anonymisierte JNV-Stadtbus-Dienstplan-PDFs (technisches Profil beu-stadtbus-v1)
  wagenkarte/      # Wagenkarten (Excel/JSON), ergänzen JES
  umlaufkarte/     # OFFEN – JNV-Umlaufkarten-Loader existiert noch nicht
  bundles/         # kombinierte Haupt+Begleit-Fixtures (Phase 3)
  synthetic/       # eindeutig synthetische Mini-Datensätze
```

Der maßgebliche Index ist `manifest.json`. Verzeichnisse ohne freigebbare Datei
werden nur über das Manifest geführt (keine leeren Platzhalter erzwungen).

## Kennzeichnung

- `sourceKind`: `anonymized` · `synthetic` · `contract-only`.
- `status`: `available` · `missing` · `planned` · `restricted`.
- Das **JNV-Hauptdokument** (Stadtbus-PDF, Profil `beu-stadtbus-v1`) **existiert** als
  reale, externe Referenz → `restricted` (außerhalb des Repos), **kein**
  `missing_reference`.
- Noch fehlende JNV-Bausteine (Umlaufkarte/Companion) tragen `marker`
  `synthetic_contract_only`/`missing_reference` und sind nie `available`.
- „BEU" ist nur eine technische Profil-ID des JNV-Stadtbus-Plans, keine eigene
  Organisation/Dokumentfamilie.

## Regeln

- Keine echten Personaldaten aufnehmen.
- Synthetische Daten immer als `synthetic`/`contract-only` kennzeichnen.
- Erfundene JNV-Umlaufkarten-Beispiele sind kein Ersatz für eine echte Referenz.
