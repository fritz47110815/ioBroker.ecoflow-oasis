# ioBroker EcoFlow Oasis 0.1.2

Experimental ioBroker adapter for reading EcoFlow data over Modbus TCP.

## Changes in 0.1.2

- Explicitly subscribes to `control.*` states so writable-state changes are delivered to `onStateChange()`.
- Adds a debug log for received state-change events.
- Keeps Control writes disabled by default because the register addresses and write protocol have not been verified for the STREAM AC 5000 (ES22).

## Configuration

Configure the device IP, Modbus TCP port, Unit-ID, address offset and polling interval in the adapter settings.

## Important safety note

The Control register offsets in this experimental adapter are inherited from an earlier MVP and are not independently verified for the STREAM AC 5000 (ES22). Do not enable `enableControlWrites` unless the register map and write protocol have been confirmed for the exact device and firmware. This release does not claim to provide working LED brightness writes.

## Installation

Install dependencies in the adapter directory with `npm install`, then start the instance and inspect the ioBroker log. Set the log level to `debug` to see incoming state-change events.

## Status

Syntax/package update only; not tested against physical EcoFlow hardware.
