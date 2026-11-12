# Abrüstzeit Block 11 Implementation Plan

**Goal:** PDF-Busdienste JES/JNV mit Dienstende ab 16:00 auf 15 Minuten Abrüstzeit an den freigegebenen Betriebshöfen prüfen.

**Architecture:** Eigener Block mit isolierter Prüffunktion und Renderer; Anbindung ausschließlich an die PDF-Ansicht. Bestehende zehn Blöcke und BV-Prüfungen bleiben unverändert. JES erkennt zusätzlich Nachbereitungszeit JES. Beide Orte müssen denselben zugelassenen Standort bezeichnen. Einzelne Abrüstzeilen werden einzeln geprüft, nicht aufsummiert. Die Zeitgrenze wird auf die angegebene Dienstende-Uhrzeit angewendet.

**Tech Stack:** JavaScript ES modules, node:test, vorhandene status-warning CSS-Klasse.

- [x] Grenzfälle, Ortsfilter, PDF/Busfilter und Darstellung testen.
- [x] Eigenes Prüf-/Anzeigemodul ergänzen und Block 11 in HTML/PDF-Ansicht anbinden.
- [x] Vorhandene PDF-Dateien über produktiven Import prüfen, Gesamttests und Diff prüfen.

Validierung: 6 neue Tests inklusive produktivem Import beider PDF-Fixtures bestanden. Gesamtlauf: 2377 bestanden, 7 übersprungen, 3 lokale Servertests durch Sandbox-EPERM blockiert; diese 3 separat mit lokalem Server erfolgreich wiederholt. git diff --check ohne Befund. Keine Veröffentlichung.
