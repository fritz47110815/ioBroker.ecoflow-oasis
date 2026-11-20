# ioBroker Adapter: ecoflow-oasis

Lokale Modbus-TCP-Anbindung für EcoFlow STREAM 5000 / STREAM AC 5000.

## Installation (Entwicklerversion)

1. ZIP entpacken, Verzeichnis nach `iobroker.ecoflow-oasis` umbenennen.
2. Im ioBroker-Host in das Verzeichnis wechseln.
3. `npm install` ausführen.
4. Adapter-Instanz anlegen und Host/IP konfigurieren.
5. In der EcoFlow-App muss Modbus TCP am Gerät aktiviert sein.

## Enthaltene Funktionen

- Lokale Modbus-TCP-Verbindung (Port 502, Unit-ID 1)
- Kern-Telemetrie: Systemleistung, Netzleistung, PV-Leistung, Batterieleistung,
  SOC, PV-Eingänge, Netz-/Batteriewerte und Energiezähler
- Heartbeat-Schreibvorgang an Register `0x025F` alle 20 Sekunden
- Erste, bewusst begrenzte Schreibobjekte: Backup-Reserve, LED-Helligkeit,
  Einspeisegrenze

## Wichtige Hinweise

Dies ist ein **MVP / Entwicklungsstand 0.1.0**, kein offiziell freigegebener
oder vollständig getesteter Adapter. Die Registerliste ist eine kuratierte
Teilmenge des umfangreichen Upstream-Registersheets. Vor produktivem Einsatz
müssen Adressoffset und Datenwerte am eigenen Gerät gegengeprüft werden.

Der Upstream-Adapter gruppiert Registerblöcke, verteilt Abfragen über das
Pollingintervall und besitzt zusätzliche Wiederverbindungs-/Systemrollenlogik.
Diese erste ioBroker-Fassung fragt die aufgeführten Register einzeln ab.
Für große Registerlisten sollte das Polling auf zusammenhängende Blöcke
optimiert werden.

## Quelle und Lizenz

Die Registerdefinitionen und Protokollannahmen orientieren sich an:
https://github.com/ecoflow-oasis-official/ha-ecoflow-official

Das Upstream-Projekt nennt die MIT-Lizenz. Diese Adapter-Neuentwicklung ist
ebenfalls als MIT lizenziert; bitte Lizenz-/Copyright-Hinweise bei einer
späteren Übernahme von Quelltext vollständig beibehalten.
