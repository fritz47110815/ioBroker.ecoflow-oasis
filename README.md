# ioBroker.ecoflow-oasis 0.1.1

Experimenteller ioBroker-Adapter für EcoFlow STREAM AC 5000 (ES22) über Modbus TCP.

## Änderungen in 0.1.1
- Control-Datenpunkte werden jetzt im Polling mitgelesen.
- Aktualisierte Control-Werte werden mit `ack: true` gesetzt.
- State-IDs werden sowohl als relative als auch als vollständig qualifizierte ioBroker-IDs verarbeitet.
- Mehr Diagnose-Logs und `info.lastPoll`.
- Schreibzugriffe auf Control sind standardmäßig gesperrt.

## Wichtiger Hinweis zum ES22
Diese Version ist **nicht als vollständig bestätigte ES22-Protokollimplementierung zu verstehen**. Die Register-Offsets aus Version 0.1.0 wurden übernommen und sind nicht anhand der vollständigen aktuellen EcoFlow-ES22-Registerdefinition verifiziert. Insbesondere die drei bisherigen Control-Adressen und Skalierungen sind unbestätigt.

Deshalb ist `enableControlWrites` standardmäßig `false`. Nicht aktivieren, solange die Control-Registeradressen, Datentypen und Skalierungen nicht mit der passenden ES22-Protokollversion abgeglichen wurden. Auch das Lesen dieser Control-Register kann ohne korrekte Zuordnung keine gültigen Werte garantieren.

Die offizielle Home-Assistant-Integration beschreibt für ES22 eine eigene Registerabdeckung und separate Control-Register. Ein einfacher Abgleich von Namen oder ähnlichen Modellen reicht nicht aus.

## Installation
1. ZIP entpacken.
2. Im ioBroker-Adapterverzeichnis installieren bzw. den bestehenden Adapterordner sichern und ersetzen.
3. Abhängigkeiten installieren: `npm install`.
4. Adapterinstanz starten und Host/Port/Unit-ID prüfen.
5. Logs zunächst auf Debug stellen und die Control-Objekte beobachten.

## Diagnose
- `info.connection`: Modbus-Verbindungsstatus
- `info.lastPoll`: Zeitpunkt des letzten Poll-Durchlaufs
- Einzelne Register-Lesefehler erscheinen bei Debug-Loglevel.

## Lizenz
MIT
