"use strict";

const utils = require("@iobroker/adapter-core");
const ModbusRTU = require("modbus-serial");

// NOTE: These register offsets are inherited from the first MVP and have NOT
// been independently verified against the current STREAM AC 5000 register map.
// Do not enable control writes until the offsets/scaling are confirmed for your
// firmware/device by the official protocol documentation.
const REGISTERS = [
  [0x0001,"system_phase","System phase","UINT16",""],
  [0x0003,"serial_number","Serial number","STRING",""],
  [0x000B,"firmware_version","Firmware version","UINT32",""],
  [0x0016,"inverter_active_power","Inverter total active power","INT16","W"],
  [0x0206,"system_consumption_power","System consumption power","FLOAT","W"],
  [0x0208,"system_grid_power","System grid power","FLOAT","W"],
  [0x020A,"system_pv_power","System PV power","FLOAT","W"],
  [0x020C,"system_battery_power","System battery power","FLOAT","W"],
  [0x020E,"system_soc","System SOC","UINT16","%"],
  [0x0227,"battery_capacity","Battery capacity","FLOAT","kWh"],
  [0x0229,"battery_available_charge_power","Battery available charge power","FLOAT","W"],
  [0x022B,"battery_available_discharge_power","Battery available discharge power","FLOAT","W"],
  [0x022E,"grid_current_l1","Grid current L1","FLOAT","A"],
  [0x0230,"grid_current_l2","Grid current L2","FLOAT","A"],
  [0x0232,"grid_current_l3","Grid current L3","FLOAT","A"],
  [0x0234,"grid_voltage_l1","Grid voltage L1","FLOAT","V"],
  [0x0236,"grid_voltage_l2","Grid voltage L2","FLOAT","V"],
  [0x0238,"grid_voltage_l3","Grid voltage L3","FLOAT","V"],
  [0x023D,"battery_voltage","Battery voltage","FLOAT","V"],
  [0x023F,"battery_current","Battery current","FLOAT","A"],
  [0x0241,"battery_temperature","Battery temperature","FLOAT","°C"],
  [0x0253,"pv1_voltage","PV1 voltage","FLOAT","V"],
  [0x0255,"pv1_current","PV1 current","FLOAT","A"],
  [0x0257,"pv2_voltage","PV2 voltage","FLOAT","V"],
  [0x0259,"pv2_current","PV2 current","FLOAT","A"],
  [0x025B,"pv3_voltage","PV3 voltage","FLOAT","V"],
  [0x025D,"pv3_current","PV3 current","FLOAT","A"],
  [0x2400,"grid_status","Grid status","UINT16",""],
  [0x2401,"bypass_ac1_power","Bypass AC1 power","FLOAT","W"],
  [0x2404,"bypass_ac2_power","Bypass AC2 power","FLOAT","W"],
  [0x2407,"bypass_ac3_power","Bypass AC3 power","FLOAT","W"],
  [0x0870,"grid_import_energy_total","Grid import energy total","FLOAT","kWh"],
  [0x0872,"grid_import_energy_today","Grid import energy today","FLOAT","kWh"],
  [0x0880,"grid_export_energy_total","Grid export energy total","FLOAT","kWh"],
  [0x0882,"grid_export_energy_today","Grid export energy today","FLOAT","kWh"],
  [0x08D0,"solar_energy_total","Solar energy total","FLOAT","kWh"],
  [0x0800,"system_fault_count","System fault count","UINT16",""]
];

const CONTROL_DEFS = [
  { id:"backup_reserve_ratio", name:"Backup reserve ratio", offset:0x0217, min:0, max:100, unit:"%" },
  { id:"led_brightness", name:"LED brightness", offset:0x021C, min:0, max:100, unit:"%" },
  { id:"feed_in_limit", name:"Feed-in limit", offset:0x023C, min:1, max:100, unit:"%" }
];

const WORDS = { UINT16:1, INT16:1, UINT32:2, INT32:2, FLOAT:2, STRING:8 };

class EcoflowOasis extends utils.Adapter {
  constructor(options = {}) {
    super({ ...options, name:"ecoflow-oasis" });
    this.client = new ModbusRTU();
    this.connected = false;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.pollBusy = false;
    this.stopping = false;

    this.on("ready", () => this.start());
    this.on("stateChange", (id, state) => this.onStateChange(id, state));
    this.on("unload", cb => this.stop(cb));
  }

  async start() {
    const cfg = this.config;
    this.log.info("EcoFlow Oasis Adapter startet.");
    if (!cfg.host) {
      this.log.error("Keine EcoFlow-IP-Adresse konfiguriert.");
      return;
    }

    this.base = Number.isFinite(Number(cfg.addressOffset)) ? Number(cfg.addressOffset) : 40001;
    await this.createObjects();
    // Subscribe explicitly so changes to our writable Control states reach onStateChange.
    await this.subscribeStates("control.*");
    this.log.info("State-Überwachung für control.* aktiviert.");

    try {
      await this.connect();
      await this.poll();
      this.pollTimer = setInterval(() => this.poll(), Math.max(2, Number(cfg.pollInterval) || 5) * 1000);
    } catch (err) {
      this.log.error(`Verbindung zu ${cfg.host}:${cfg.port || 502} fehlgeschlagen: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  async connect() {
    this.client = new ModbusRTU();
    this.client.setTimeout(4000);
    await this.client.connectTCP(this.config.host, { port:Number(this.config.port) || 502 });
    this.client.setID(Number(this.config.unitId) || 1);
    this.connected = true;
    await this.setStateAsync("info.connection", true, true);
    this.log.info(`Modbus TCP verbunden: ${this.config.host}:${Number(this.config.port) || 502}, Unit-ID ${Number(this.config.unitId) || 1}`);
  }

  async createObjects() {
    await this.setObjectNotExistsAsync("info", { type:"channel", common:{ name:"Verbindungsstatus" }, native:{} });
    await this.setObjectNotExistsAsync("info.connection", {
      type:"state",
      common:{ name:"Verbindung", type:"boolean", role:"indicator.connected", read:true, write:false },
      native:{}
    });
    await this.setObjectNotExistsAsync("info.lastPoll", {
      type:"state",
      common:{ name:"Letzter erfolgreicher Poll", type:"string", role:"text", read:true, write:false },
      native:{}
    });

    for (const [offset, id, name, dtype, unit] of REGISTERS) {
      await this.setObjectNotExistsAsync(id, {
        type:"state",
        common:{
          name, type:dtype === "STRING" ? "string" : "number",
          role:unit === "W" ? "value.power" : unit === "%" ? "value.battery" : unit === "kWh" ? "value.energy" : "value",
          unit, read:true, write:false
        },
        native:{ offset, dtype }
      });
    }

    await this.setObjectNotExistsAsync("control", { type:"channel", common:{ name:"Control" }, native:{} });
    for (const c of CONTROL_DEFS) {
      await this.setObjectNotExistsAsync(`control.${c.id}`, {
        type:"state",
        common:{ name:c.name, type:"number", role:"level", unit:c.unit, min:c.min, max:c.max, read:true, write:true },
        native:{ offset:c.offset, dtype:"UINT16", unverified:true }
      });
    }
  }

  async readRegister(offset, dtype) {
    const count = WORDS[dtype] || 1;
    const result = await this.client.readHoldingRegisters(this.base + offset, count);
    const words = result.data;
    if (dtype === "UINT16") return words[0];
    if (dtype === "INT16") return words[0] > 32767 ? words[0] - 65536 : words[0];

    const buf = Buffer.alloc(4);
    buf.writeUInt16BE(words[0], 0);
    buf.writeUInt16BE(words[1], 2);
    if (dtype === "UINT32") return buf.readUInt32BE(0);
    if (dtype === "INT32") return buf.readInt32BE(0);
    if (dtype === "FLOAT") return Number(buf.readFloatBE(0).toFixed(4));
    if (dtype === "STRING") {
      const str = Buffer.alloc(count * 2);
      words.forEach((v, i) => str.writeUInt16BE(v, i * 2));
      return str.toString("ascii").replace(/\0+$/g, "").trim();
    }
    throw new Error(`Unbekannter Datentyp: ${dtype}`);
  }

  async writeRegister(offset, value) {
    await this.client.writeRegister(this.base + offset, Number(value) & 0xffff);
  }

  async poll() {
    if (this.pollBusy || !this.connected || this.stopping) return;
    this.pollBusy = true;
    let successes = 0;

    try {
      for (const [offset, id, , dtype] of REGISTERS) {
        try {
          const value = await this.readRegister(offset, dtype);
          if (value !== null && !(typeof value === "number" && !Number.isFinite(value))) {
            await this.setStateAsync(id, { val:value, ack:true });
            successes++;
          }
        } catch (err) {
          this.log.debug(`Lesefehler ${id} (Register 0x${offset.toString(16)}): ${err.message}`);
        }
      }

      // FIX: Control states are now polled and updated from their configured registers.
      for (const control of CONTROL_DEFS) {
        try {
          const value = await this.readRegister(control.offset, "UINT16");
          await this.setStateAsync(`control.${control.id}`, { val:value, ack:true });
          successes++;
        } catch (err) {
          this.log.debug(`Lesefehler Control.${control.id} (Register 0x${control.offset.toString(16)}): ${err.message}`);
        }
      }

      await this.setStateAsync("info.connection", true, true);
      await this.setStateAsync("info.lastPoll", new Date().toISOString(), true);
      this.log.debug(`Polling abgeschlossen: ${successes} Registerwerte aktualisiert.`);
    } catch (err) {
      this.log.warn(`Polling fehlgeschlagen: ${err.message}`);
      this.connected = false;
      await this.setStateAsync("info.connection", false, true);
      this.scheduleReconnect();
    } finally {
      this.pollBusy = false;
    }
  }

  normalizeStateId(id) {
    if (!id) return "";
    const prefix = `${this.namespace}.`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  }

  async onStateChange(id, state) {
    this.log.debug(`StateChange empfangen: ${id}, ack=${state ? state.ack : "undefined"}, val=${state ? state.val : "undefined"}`);
    const relativeId = this.normalizeStateId(id);
    if (!relativeId.startsWith("control.") || !state || state.ack) return;

    const key = relativeId.slice("control.".length);
    const control = CONTROL_DEFS.find(c => c.id === key);
    if (!control) {
      this.log.warn(`Unbekanntes Control-Objekt: ${id}`);
      return;
    }

    const value = Number(state.val);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < control.min || value > control.max) {
      this.log.warn(`Ungültiger Wert für Control.${key}: ${state.val}`);
      return;
    }

    // The old MVP register addresses are not verified for ES22. Writes therefore
    // remain opt-in to avoid sending an unverified command to the inverter.
    if (this.config.enableControlWrites !== true) {
      this.log.warn(`Schreibvorgang für Control.${key} blockiert: Registerzuordnung nicht bestätigt. Erst nach Prüfung der ES22-Protokollversion enableControlWrites aktivieren.`);
      return;
    }

    if (!this.connected) {
      this.log.warn(`Schreibvorgang für Control.${key} nicht möglich: Modbus nicht verbunden.`);
      return;
    }

    try {
      this.log.info(`Schreibauftrag Control.${key}=${value} empfangen.`);
      await this.writeRegister(control.offset, value);
      const actual = await this.readRegister(control.offset, "UINT16");
      await this.setStateAsync(`control.${key}`, { val:actual, ack:true });
      this.log.info(`Control.${key}: Registerantwort=${actual}.`);
    } catch (err) {
      this.log.error(`Schreiben von Control.${key} fehlgeschlagen: ${err.message}`);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.stopping) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        await this.poll();
      } catch (err) {
        this.log.warn(`Reconnect fehlgeschlagen: ${err.message}`);
        this.connected = false;
        this.scheduleReconnect();
      }
    }, 5000);
  }

  stop(callback) {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.client.close(() => {}); } catch (_) {}
    callback();
  }
}

if (module.parent) module.exports = options => new EcoflowOasis(options);
else new EcoflowOasis();
